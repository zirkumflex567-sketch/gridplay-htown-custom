#!/usr/bin/env node
'use strict';

const http = require('http');
const { URL } = require('url');
const { Readable } = require('stream');
const fs = require('fs/promises');
const path = require('path');
const { all: allScrapers, byId: scrapersById } = require('./scrapers');
const { scoreVideo, htmlDecode, MIN_VIDEO_DURATION } = require('./scrapers/shared');
const { resolveUrl } = require('./src/resolver');
const { classifyUrlWithRegistry, getProviderByDomain } = require('./src/providers');
const { logger } = require('./src/observability/logger');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3352);
const VIDEO_ERROR_LOG_PATH = process.env.VIDEO_ERROR_LOG_PATH_V2
  ? path.resolve(process.env.VIDEO_ERROR_LOG_PATH_V2)
  : path.join(__dirname, 'tmp', 'logs', 'video-errors.jsonl');

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

function sanitizeString(value, maxLength = 2048) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function sanitizeContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const safe = {};
  for (const [key, val] of Object.entries(value).slice(0, 25)) {
    const safeKey = sanitizeString(key, 80);
    if (!safeKey) continue;
    if (typeof val === 'string') safe[safeKey] = sanitizeString(val, 512);
    else if (typeof val === 'number' && Number.isFinite(val)) safe[safeKey] = val;
    else if (typeof val === 'boolean' || val === null) safe[safeKey] = val;
  }
  return safe;
}

function sanitizeVideoErrorPayload(payload) {
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return {
    url: sanitizeString(input.url, 4096),
    reasonCode: sanitizeString(input.reasonCode, 64) || 'unknown',
    message: sanitizeString(input.message, 1024),
    context: sanitizeContext(input.context),
    videoId: sanitizeString(input.videoId, 128),
    attempt: Number.isFinite(Number(input.attempt)) ? Math.max(1, Math.min(20, Math.round(Number(input.attempt)))) : null,
    timestamp: (() => {
      const ts = sanitizeString(input.timestamp, 64);
      const parsed = ts ? new Date(ts) : new Date();
      return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    })()
  };
}

async function handleVideoErrors(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (_) {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const entry = sanitizeVideoErrorPayload(body);
  try {
    await fs.mkdir(path.dirname(VIDEO_ERROR_LOG_PATH), { recursive: true });
    await fs.appendFile(VIDEO_ERROR_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: `Failed to persist video error log: ${error.message}` });
  }
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

const PMVHAVEN_AUTH_PATH = process.env.PMVHAVEN_AUTH_PATH ||
  path.resolve(__dirname, '../gridplay-api/data/pmvhaven-auth.json');
const PMVHAVEN_HOSTS = new Set(['pmvhaven.com', 'www.pmvhaven.com']);
const PMVHAVEN_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

async function pmvhavenCookieFor(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host !== 'pmvhaven.com' && !host.endsWith('.pmvhaven.com')) return null;
  try {
    const auth = JSON.parse(await fs.readFile(PMVHAVEN_AUTH_PATH, 'utf8'));
    return typeof auth.cookies === 'string' && auth.cookies ? auth.cookies : null;
  } catch (_) {
    return null;
  }
}

async function fetchHtml(url, headers = {}) {
  const cookie = await pmvhavenCookieFor(url);
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': cookie ? PMVHAVEN_AGENT : 'GridPlayV2/2.0',
      Accept: 'text/html,application/xhtml+xml',
      ...(cookie ? { Cookie: cookie, Referer: 'https://pmvhaven.com/' } : {}),
      ...headers
    },
    signal: AbortSignal.timeout(15000)
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

  const minViews = Math.max(0, body.minViews !== undefined ? Number(body.minViews) : 50000);
  const minRating = Math.max(0, Math.min(100, body.minRating !== undefined ? Number(body.minRating) : 80));
  const minDuration = Math.max(0, body.minDuration !== undefined ? Number(body.minDuration) : MIN_VIDEO_DURATION); // Use global constant
  const pages = Math.max(1, Math.min(6, body.pages !== undefined ? Number(body.pages) : 2));
  const limit = Math.max(1, Math.min(600, body.limit !== undefined ? Number(body.limit) : 250));
  const selectedSites = Array.isArray(body.sites)
    ? body.sites.filter((s) => scrapersById.has(s))
    : allScrapers.map((s) => s.id);

  const errors = [];

  const sortedResultsPerSite = new Map();
  for (const siteId of selectedSites) {
    const scraper = scrapersById.get(siteId);
    let siteCandidates = [];
    for (let page = 1; page <= pages; page += 1) {
      try {
        const searchUrl = scraper.buildSearchUrl(query, page);
        const html = await fetchHtml(searchUrl);
        siteCandidates.push(...scraper.parseSearchResults(html).map((entry) => ({ ...entry, searchUrl })));
      } catch (error) {
        errors.push({ site: siteId, page, error: error.message });
      }
    }

    // Deduplicate per site
    const siteDedup = new Map();
    for (const entry of siteCandidates) {
      if (!siteDedup.has(entry.pageUrl)) siteDedup.set(entry.pageUrl, entry);
    }

    // Filter, Score, and Sort within the site
    const siteResults = [...siteDedup.values()]
      .map(entry => ({ ...entry, score: scoreVideo(entry, minViews, minRating, minDuration) }))
      .filter(entry => entry.score >= 0)
      .sort((a, b) => b.score - a.score);

    sortedResultsPerSite.set(siteId, siteResults);
  }

  // Interleaving Results (Provider Balancing) - True Fair Mix
  const results = [];
  const maxPerSite = Math.max(...Array.from(sortedResultsPerSite.values()).map(r => r.length), 0);
  
  for (let i = 0; i < maxPerSite; i++) {
    for (const siteId of selectedSites) {
      const list = sortedResultsPerSite.get(siteId);
      if (list && list[i]) {
        results.push(list[i]);
      }
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  sendJson(res, 200, { query, selectedSites, filters: { minViews, minRating, pages, limit }, availableSites: allScrapers.map((s) => s.id), count: results.length, results, errors });
}

async function handleResolve(req, reqUrl, res) {
  let raw = reqUrl.searchParams.get('url');
  
  if (!raw && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      raw = body.url;
    } catch (_) {
      sendJson(res, 400, { error: 'Invalid JSON body for POST resolve.' });
      return;
    }
  }

  if (!raw) {
    sendJson(res, 400, { error: 'url parameter is required (query or POST body).' });
    return;
  }

  let pageUrl;
  try {
    pageUrl = validatedHttps(raw);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const startTime = Date.now();
  try {
    const result = await resolveUrl(pageUrl.toString());
    const durationMs = Date.now() - startTime;
    logger.logResolve(pageUrl.toString(), result, durationMs);
    
    if (result.mediaUrl) {
      sendJson(res, 200, {
        sourceUrl: pageUrl.toString(),
        mediaUrl: result.mediaUrl,
        mediaType: result.mediaType,
        streamUrl: result.streamUrl,
        // Compatibility names for V2 UI
        url: result.streamUrl || result.mediaUrl,
        playbackUrl: result.streamUrl || result.mediaUrl,
        title: result.title,
        duration: result.durationSeconds,
        source: result.source,
        classification: result.classification,
        resolverPath: result.resolverPath
      });
    } else {
      sendJson(res, 502, { error: result.error || 'No playable media found', classification: result.classification });
    }
  } catch (error) {
    logger.logResolveError(pageUrl.toString(), error, 'resolve');
    sendJson(res, 502, { error: `Resolve failed: ${error.message}` });
  }
}

async function handlePlaylist(reqUrl, res) {
  const raw = reqUrl.searchParams.get('url');
  if (!raw) return sendJson(res, 400, { error: 'url parameter is required.' });
  let parsed;
  try {
    parsed = validatedHttps(raw);
    if (!PMVHAVEN_HOSTS.has(parsed.hostname.toLowerCase()) ||
        !/^\/playlists\/[^/]+\/?$/i.test(parsed.pathname)) {
      return sendJson(res, 400, { error: 'A PMVHaven playlist URL is required.' });
    }
  } catch (_) {
    return sendJson(res, 400, { error: 'Invalid playlist URL.' });
  }
  try {
    const provider = getProviderByDomain(parsed.hostname);
    const playlist = await provider.resolvePlaylist(parsed.toString(), { fetchHtml });
    const items = playlist.items || [];
    const fallbackLinks = items.length ? [] : collectPlaylistLinksFromHtml(await fetchHtml(parsed.toString()));
    const normalizedItems = items.length ? items :
      fallbackLinks.map(pageUrl => ({ pageUrl, mediaUrl: null, streamUrl: null, source: 'pmvhaven' }));
    sendJson(res, 200, {
      url: parsed.toString(), count: normalizedItems.length,
      links: normalizedItems.map(item => item.pageUrl),
      resolvedCount: normalizedItems.filter(item => item.streamUrl).length,
      streamLinks: normalizedItems.map(item => item.streamUrl).filter(Boolean),
      items: normalizedItems
    });
  } catch (error) {
    sendJson(res, 502, { error: `Playlist extraction failed: ${error.message}` });
  }
}

function collectPlaylistLinksFromHtml(html) {
  const normalized = htmlDecode(html || '');
  const matches = normalized.match(/(?:https:\/\/(?:www\.)?pmvhaven\.com)?\/videos?\/[a-zA-Z0-9_-]+/gi) || [];
  const seen = new Set();
  const results = [];
  for (const raw of matches) {
    const link = raw.startsWith('http') ? raw : `https://pmvhaven.com${raw}`;
    const clean = link.split('?')[0].split('#')[0].toLowerCase();
    if (!seen.has(clean)) {
      seen.add(clean);
      results.push(link);
    }
  }
  return results;
}

async function handlePawgMix(reqUrl, res) {
  const mode = reqUrl.searchParams.get('mode') || 'count';
  const count = Math.min(Math.max(Number(reqUrl.searchParams.get('count')) || 8, 1), 50);
  
  try {
    const searchUrl = `https://pmvhaven.com/search?q=pawg&page=1`;
    const html = await fetchHtml(searchUrl);
    const scraper = scrapersById.get('pmvhaven');
    const results = scraper.parseSearchResults(html).slice(0, count);

    const items = [];
    // A video page is HTML, never a stream URL. Resolve candidates before returning.
    for (const item of results) {
      try {
        const resolved = await resolveUrl(item.pageUrl, { useEmbedFallback: false });
        if (!resolved.mediaUrl || !['mp4', 'm3u8'].includes(resolved.mediaType)) continue;
        const playbackUrl = resolved.streamUrl;
        items.push({ ...item, mediaUrl: resolved.mediaUrl, mediaType: resolved.mediaType,
          playbackUrl, streamUrl: playbackUrl });
      } catch (_) {}
    }
    sendJson(res, 200, {
      mode, count: items.length,
      breakdown: { pmvhaven: items.length, fallback: 0 },
      items
    });
  } catch (error) {
    sendJson(res, 502, { error: `PAWG mix failed: ${error.message}` });
  }
}

async function handleClassify(reqUrl, res) {
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
    const classification = classifyUrlWithRegistry(pageUrl.toString());
    logger.logClassifier(pageUrl.toString(), classification);
    sendJson(res, 200, classification);
  } catch (error) {
    sendJson(res, 500, { error: `Classification failed: ${error.message}` });
  }
}

function handleProviders(res) {
  const providers = getProviderByDomain ? [] : [];
  const { getAllProviders } = require('./src/providers');
  const all = getAllProviders();
  const providerList = all
    .filter(p => p.id !== 'generic')
    .map(p => ({
      id: p.id,
      domains: p.domains,
      supportsVideo: typeof p.resolveVideo === 'function',
      supportsPlaylist: typeof p.resolvePlaylist === 'function',
      supportsSearch: typeof p.search === 'function'
    }));
  sendJson(res, 200, { providers: providerList, count: providerList.length });
}

async function handleStream(req, reqUrl, res) {
  const raw = reqUrl.searchParams.get('url');
  if (!raw) return sendJson(res, 400, { error: 'url query parameter is required.' });
  let mediaUrl;
  try {
    mediaUrl = validatedHttps(raw);
    // Never proxy PMVHaven HTML pages as media: video tags cannot decode HTML.
    if (PMVHAVEN_HOSTS.has(mediaUrl.hostname) &&
        /^\/(videos?|playlists?)\//i.test(mediaUrl.pathname)) {
      return sendJson(res, 422, { error: 'This is a video/playlist page. Resolve its media URL first.' });
    }
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  try {
    const cookie = await pmvhavenCookieFor(mediaUrl.toString());
    const headers = {
      'User-Agent': cookie ? PMVHAVEN_AGENT : 'GridPlayV2Proxy/2.0',
      Referer: cookie ? 'https://pmvhaven.com/' : `${mediaUrl.protocol}//${mediaUrl.hostname}/`,
      Accept: '*/*'
    };
    if (cookie) headers.Cookie = cookie;
    if (req.headers.range) headers.Range = req.headers.range;
    let fetchMethod = req.method;
    if (fetchMethod === 'HEAD' && mediaUrl.pathname.includes('/download')) {
      fetchMethod = 'GET';
    }

    let upstream = await fetch(mediaUrl, {
      method: fetchMethod, redirect: 'follow', headers, signal: AbortSignal.timeout(30000)
    });

    if (!upstream.ok && upstream.status !== 206 && req.method === 'HEAD') {
      upstream = await fetch(mediaUrl, {
        method: 'GET', redirect: 'follow', headers, signal: AbortSignal.timeout(30000)
      });
    }
    if (!upstream.ok && upstream.status !== 206) {
      return sendJson(res, upstream.status, { error: `Upstream returned HTTP ${upstream.status}.` });
    }
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      return sendJson(res, 422, { error: 'Upstream returned HTML, not a video. Re-resolve the source URL.' });
    }
    const keys = ['content-type', 'content-length', 'content-range', 'accept-ranges',
      'cache-control', 'etag', 'last-modified', 'content-disposition'];
    const responseHeaders = { 'X-GridPlay-Proxy': 'v2' };
    for (const key of keys) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders[key] = value;
    }
    const isHls = contentType.includes('mpegurl') || mediaUrl.pathname.toLowerCase().endsWith('.m3u8');
    if (isHls && req.method !== 'HEAD') {
      const manifest = await upstream.text();
      const baseUrl = upstream.url || mediaUrl.toString();
      const toProxy = uri => {
        const target = new URL(uri, baseUrl);
        if (target.protocol !== 'https:') throw new Error('Insecure HLS segment URL');
        return `/gridplay-api-v2/stream?url=${encodeURIComponent(target.toString())}`;
      };
      const rewritten = manifest.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/g, (whole, uri) => {
            try { return `URI="${toProxy(uri)}"`; } catch (_) { return whole; }
          });
        }
        try { return toProxy(trimmed); } catch (_) { return line; }
      }).join('\n');
      const body = Buffer.from(rewritten, 'utf8');
      responseHeaders['content-type'] = 'application/vnd.apple.mpegurl';
      responseHeaders['content-length'] = String(body.length);
      res.writeHead(upstream.status, responseHeaders);
      return res.end(body);
    }
    res.writeHead(upstream.status, responseHeaders);
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    if (!res.headersSent) sendJson(res, 502, { error: `Stream proxy failed: ${error.message}` });
    else res.destroy(error);
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!['GET', 'POST', 'HEAD'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed.' });
  if (reqUrl.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'gridplay-api-v2' });
  if (reqUrl.pathname === '/video-errors' && req.method === 'POST') return handleVideoErrors(req, res);
  if (reqUrl.pathname === '/search' && req.method === 'POST') return handleSearch(req, res);
  if (reqUrl.pathname === '/resolve') return handleResolve(req, reqUrl, res);
  if (reqUrl.pathname === '/playlist' && req.method === 'GET') return handlePlaylist(reqUrl, res);
  if (reqUrl.pathname === '/pawg-mix' && req.method === 'GET') return handlePawgMix(reqUrl, res);
  if (reqUrl.pathname === '/classify' && req.method === 'GET') return handleClassify(reqUrl, res);
  if (reqUrl.pathname === '/providers' && req.method === 'GET') return handleProviders(res);
  if (reqUrl.pathname === '/stream') return handleStream(req, reqUrl, res);
  return sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`GridPlay API v2 listening on ${HOST}:${PORT}\n`);
});
