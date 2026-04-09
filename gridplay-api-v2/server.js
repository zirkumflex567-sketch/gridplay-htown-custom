#!/usr/bin/env node
'use strict';

const http = require('http');
const { URL } = require('url');
const { Readable } = require('stream');
const { all: allScrapers, byId: scrapersById } = require('./scrapers');
const { scoreVideo, htmlDecode } = require('./scrapers/shared');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3352);

function sendJson(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function validatedHttps(raw) {
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('Only https URLs are allowed.');
  return parsed;
}

function extractMediaCandidates(html) {
  const normalized = htmlDecode(html || '');
  const patterns = [
    /https:\/\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?/gi,
    /https:\/\/[^"'\s<>]+?\.m3u8(?:\?[^"'\s<>]*)?/gi,
    /"contentUrl"\s*:\s*"(https:[^"]+)"/gi,
    /"videoUrl"\s*:\s*"(https:[^"]+)"/gi
  ];
  const results = [];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const raw = htmlDecode(match[1] || match[0]);
      try {
        const item = validatedHttps(raw).toString();
        if (!seen.has(item)) {
          seen.add(item);
          results.push(item);
        }
      } catch (_) {}
    }
  }
  return results;
}

function pickBestMediaUrl(candidates) {
  if (!candidates.length) throw new Error('No media URL found on page.');
  return candidates
    .map((url) => {
      const qualityMatch = url.toLowerCase().match(/(2160|1440|1080|720|480|360|240)p/);
      const quality = qualityMatch ? Number(qualityMatch[1]) : 0;
      const score = (url.includes('.mp4') ? 10000 : 0) + quality;
      return { url, score };
    })
    .sort((a, b) => b.score - a.score)[0].url;
}

async function fetchHtml(url, headers = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'GridPlayV2/2.0 (+https://h-town.duckdns.org/gridplay/v2/)',
      Accept: 'text/html,application/xhtml+xml',
      ...headers
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function handleSearch(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (_) {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const query = String(body.query || '').trim();
  if (!query) {
    sendJson(res, 400, { error: 'query is required.' });
    return;
  }

  const minViews = Math.max(0, Number(body.minViews || 50000));
  const minRating = Math.max(0, Math.min(100, Number(body.minRating || 80)));
  const pages = Math.max(1, Math.min(6, Number(body.pages || 2)));
  const limit = Math.max(1, Math.min(600, Number(body.limit || 250)));
  const selectedSites = Array.isArray(body.sites)
    ? body.sites.filter((s) => scrapersById.has(s))
    : allScrapers.map((s) => s.id);

  const candidates = [];
  const errors = [];

  for (const siteId of selectedSites) {
    const scraper = scrapersById.get(siteId);
    for (let page = 1; page <= pages; page += 1) {
      try {
        const searchUrl = scraper.buildSearchUrl(query, page);
        const html = await fetchHtml(searchUrl);
        candidates.push(...scraper.parseSearchResults(html).map((entry) => ({ ...entry, searchUrl })));
      } catch (error) {
        errors.push({ site: siteId, page, error: error.message });
      }
    }
  }

  const dedup = new Map();
  for (const candidate of candidates) {
    const current = dedup.get(candidate.pageUrl);
    if (!current || scoreVideo(candidate, 0, 0) > scoreVideo(current, 0, 0)) dedup.set(candidate.pageUrl, candidate);
  }

  const results = [...dedup.values()]
    .map((entry) => ({ ...entry, score: scoreVideo(entry, minViews, minRating) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  sendJson(res, 200, { query, selectedSites, filters: { minViews, minRating, pages, limit }, availableSites: allScrapers.map((s) => s.id), count: results.length, results, errors });
}

async function handleResolve(reqUrl, res) {
  const raw = reqUrl.searchParams.get('url');
  if (!raw) {
    sendJson(res, 400, { error: 'url query parameter is required.' });
    return;
  }

  let pageUrl;
  try {
    pageUrl = validatedHttps(raw);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  try {
    const html = await fetchHtml(pageUrl.toString(), { Referer: `${pageUrl.protocol}//${pageUrl.hostname}/` });
    const mediaUrl = pickBestMediaUrl(extractMediaCandidates(html));
    sendJson(res, 200, { sourceUrl: pageUrl.toString(), mediaUrl, streamUrl: `/gridplay-api-v2/stream?url=${encodeURIComponent(mediaUrl)}` });
  } catch (error) {
    sendJson(res, 502, { error: `Resolve failed: ${error.message}` });
  }
}

async function handleStream(req, reqUrl, res) {
  const raw = reqUrl.searchParams.get('url');
  if (!raw) return sendJson(res, 400, { error: 'url query parameter is required.' });

  let mediaUrl;
  try {
    mediaUrl = validatedHttps(raw);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  try {
    const headers = { 'User-Agent': 'GridPlayV2Proxy/2.0', Referer: `${mediaUrl.protocol}//${mediaUrl.hostname}/` };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(mediaUrl, { method: req.method, redirect: 'follow', headers });
    if (!upstream.ok && upstream.status !== 206) return sendJson(res, upstream.status, { error: `Upstream returned HTTP ${upstream.status}.` });

    const keys = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified', 'content-disposition'];
    const responseHeaders = { 'X-GridPlay-Proxy': 'v2' };
    for (const key of keys) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders[key] = value;
    }

    res.writeHead(upstream.status, responseHeaders);
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    sendJson(res, 502, { error: `Stream proxy failed: ${error.message}` });
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!['GET', 'POST', 'HEAD'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed.' });
  if (reqUrl.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'gridplay-api-v2' });
  if (reqUrl.pathname === '/search' && req.method === 'POST') return handleSearch(req, res);
  if (reqUrl.pathname === '/resolve' && req.method === 'GET') return handleResolve(reqUrl, res);
  if (reqUrl.pathname === '/stream') return handleStream(req, reqUrl, res);
  return sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`GridPlay API v2 listening on ${HOST}:${PORT}\n`);
});
