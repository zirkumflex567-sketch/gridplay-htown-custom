'use strict';

const { htmlDecode } = require('../../scrapers/shared');

const PROVIDER_ID = 'generic';
const DOMAINS = [];

function collectMediaCandidates(html) {
  const normalized = htmlDecode(html);
  const candidates = [];
  const seen = new Set();

  const patterns = [
    /https:\/\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?/gi,
    /https:\/\/[^"'\s<>]+?\.m3u8(?:\?[^"'\s<>]*)?/gi,
    /"contentUrl"\s*:\s*"([^"]+)"/gi,
    /videoUrl\s*[=:]\s*['"]([^'"]+)['"]/gi,
    /source\s+src\s*=\s*['"]([^'"]+)['"]/gi,
    /<video[^>]*src\s*=\s*['"]([^'"]+)['"]/gi
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const url = htmlDecode(match[1] || match[0]);
      if (!url || seen.has(url)) continue;
      if (url.includes('.mp4') || url.includes('.m3u8')) {
        seen.add(url);
        const isMp4 = url.includes('.mp4');
        candidates.push({ url, mediaType: isMp4 ? 'mp4' : 'm3u8', resolution: isMp4 ? extractResolution(url) : 0 });
      }
    }
  }

  return candidates;
}

function extractResolution(url) {
  const match = url.toLowerCase().match(/(2160|1440|1080|720|480|360|240)p/);
  return match ? Number(match[1]) : 0;
}

function pickBestMedia(candidates) {
  if (candidates.length === 0) return null;
  return candidates
    .map(c => ({ ...c, score: (c.mediaType === 'mp4' ? 10000 : 0) + c.resolution }))
    .sort((a, b) => b.score - a.score)[0];
}

function classifyUrl(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();

  const signals = [`host:${hostname}`];

  const isVideo = /\.(mp4|m3u8|webm|avi|mov)/i.test(pathname) ||
                  /\/video[\/]?[a-zA-Z0-9-]*$/i.test(pathname) ||
                  /\/watch\//i.test(pathname);

  const isPlaylist = /\/playlist/i.test(pathname) || /list=/i.test(search);
  const isProfile = /\/users?\//i.test(pathname) || /\/profile/i.test(pathname);
  const isSearch = /\/search/i.test(pathname) || /[?&](q|k|query)=/i.test(search);

  if (isPlaylist) return { kind: 'playlist', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.6, signals: [...signals, 'path:playlist'] };
  if (isVideo) return { kind: 'video', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.6, signals: [...signals, 'path:video'] };
  if (isProfile) return { kind: 'profile', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.5, signals: [...signals, 'path:profile'] };
  if (isSearch) return { kind: 'search', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.5, signals: [...signals, 'path:search'] };

  return { kind: 'unknown', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.2, signals: [...signals, 'no-match'] };
}

async function resolveVideo(url, ctx = {}) {
  const { fetchHtml = defaultFetch, timeout = 12000 } = ctx;
  const html = await fetchHtml(url, { timeout });
  const candidates = collectMediaCandidates(html);
  const best = pickBestMedia(candidates);

  if (!best) {
    const embedUrl = findEmbedUrl(html, url);
    if (embedUrl) {
      return {
        pageUrl: url,
        mediaUrl: embedUrl,
        mediaType: 'embed',
        streamUrl: `/gridplay-api-v2/stream?url=${encodeURIComponent(embedUrl)}`,
        source: PROVIDER_ID,
        resolverPath: ['provider', 'generic', 'embed-fallback']
      };
    }
    throw new Error('No media URL found');
  }

  return {
    pageUrl: url,
    mediaUrl: best.url,
    mediaType: best.mediaType,
    streamUrl: `/gridplay-api-v2/stream?url=${encodeURIComponent(best.url)}`,
    title: extractTitle(html),
    durationSeconds: extractDuration(html),
    source: PROVIDER_ID,
    resolverPath: ['provider', 'generic']
  };
}

async function defaultFetch(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'GridPlayV2/2.0 (+https://h-town.duckdns.org/gridplay/v2/)',
      'Accept': 'text/html,application/xhtml+xml'
    },
    signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function findEmbedUrl(html, baseUrl) {
  const parsed = new URL(baseUrl);
  const patterns = [
    /iframe[^>]+src\s*=\s*['"]([^'"]+)['"]/gi,
    /embed\/([a-zA-Z0-9_-]+)/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const embedUrl = match[1];
      if (embedUrl && embedUrl.startsWith('http')) return embedUrl;
      if (embedUrl && embedUrl.includes('/embed/')) return `https://${parsed.hostname}${embedUrl}`;
    }
  }
  return null;
}

function extractTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? htmlDecode(match[1].replace(/\s*[-|].*$/, '')) : null;
}

function extractDuration(html) {
  const match = html.match(/(\d+):(\d+)/);
  return match ? parseInt(match[1]) * 60 + parseInt(match[2]) : null;
}

module.exports = { id: PROVIDER_ID, domains: DOMAINS, classifyUrl, resolveVideo };