'use strict';

const { htmlDecode } = require('../../scrapers/shared');

const PROVIDER_ID = 'xhamster';
const DOMAINS = ['xhamster.com', 'www.xhamster.com', 'xhamster.desi', 'www.xhamster.desi', 'xhamster44.desi', 'xhamster1.desi', 'xhamster19.com', 'xhamsterlive.com'];

function collectMediaCandidates(html) {
  const normalized = htmlDecode(html);
  const candidates = [];
  const seen = new Set();

  const mp4Pattern = /https:\/\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?/gi;
  for (const match of normalized.matchAll(mp4Pattern)) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push({ url, mediaType: 'mp4', resolution: extractResolution(url) });
  }

  const m3u8Pattern = /https:\/\/[^"'\s<>]+?\.m3u8(?:\?[^"'\s<>]*)?/gi;
  for (const match of normalized.matchAll(m3u8Pattern)) {
    const url = match[0];
    if (!seen.has(url)) {
      seen.add(url);
      candidates.push({ url, mediaType: 'm3u8', resolution: 0 });
    }
  }

  const jsonLdPattern = /"contentUrl"\s*:\s*"([^"]+\.mp4[^"]*)"/gi;
  for (const match of normalized.matchAll(jsonLdPattern)) {
    const url = htmlDecode(match[1]);
    if (!seen.has(url)) {
      seen.add(url);
      candidates.push({ url, mediaType: 'mp4', resolution: extractResolution(url) });
    }
  }

  return candidates;
}

function extractResolution(url) {
  const match = url.toLowerCase().match(/(2160|1440|1080|720|480|360|240)p/);
  return match ? Number(match[1]) : 0;
}

function pickBestMedia(candidates) {
  if (candidates.length === 0) throw new Error('No media URL found');
  return candidates
    .map(c => ({ ...c, score: (c.mediaType === 'mp4' ? 10000 : 0) + c.resolution }))
    .sort((a, b) => b.score - a.score)[0];
}

function classifyUrl(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();

  if (pathname.includes('/playlist') || pathname.includes('/playlists')) {
    return { kind: 'playlist', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.9, signals: ['xhamster-playlist-path'] };
  }
  if (pathname.includes('/video') || pathname.includes('/watch')) {
    return { kind: 'video', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.9, signals: ['xhamster-video-path'] };
  }
  if (pathname.includes('/profile') || pathname.includes('/users') || pathname.includes('/channels')) {
    return { kind: 'profile', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.85, signals: ['xhamster-profile-path'] };
  }
  if (pathname.includes('/search') || search.includes('q=')) {
    return { kind: 'search', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.8, signals: ['xhamster-search-path'] };
  }

  return { kind: 'unknown', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.3, signals: ['xhamster-unknown-path'] };
}

async function resolveVideo(url, ctx = {}) {
  const { fetchHtml = defaultFetch, timeout = 12000 } = ctx;

  const html = await fetchHtml(url, { timeout });
  const candidates = collectMediaCandidates(html);
  const best = pickBestMedia(candidates);

  return {
    pageUrl: url,
    mediaUrl: best.url,
    mediaType: best.mediaType,
    streamUrl: `/gridplay-api-v2/stream?url=${encodeURIComponent(best.url)}`,
    title: extractTitle(html),
    durationSeconds: extractDuration(html),
    source: PROVIDER_ID,
    resolverPath: ['provider', 'xhamster']
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

function extractTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? htmlDecode(match[1].replace(/\s*[-|].*$/, '')) : null;
}

function extractDuration(html) {
  // 1. Try JSON-LD or meta duration (if present)
  // XHamster often uses seconds in their initials or LD
  const metaMatch = html.match(/"duration"\s*:\s*(\d+)/i) || html.match(/video_duration\s*:\s*(\d+)/i);
  if (metaMatch) return parseInt(metaMatch[1], 10);

  // 2. Try thumb-image-container__duration or eta class
  const classMatch = html.match(/class="[^"]*(?:thumb-image-container__duration|eta)[^"]*"[^>]*>([\d:]+)<\/div>/i);
  if (classMatch) {
    const parts = classMatch[1].split(':');
    if (parts.length === 3) return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
    if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  // 3. Fallback to generic timestamp MM:SS
  const match = html.match(/(?:(\d+):)?(\d+):(\d{2})/);
  if (match) {
    const h = match[1] ? parseInt(match[1], 10) : 0;
    const m = parseInt(match[2], 10);
    const s = parseInt(match[3], 10);
    return (h * 3600) + (m * 60) + s;
  }

  return null;
}

function extractPlaylistItems(html) {
  const items = [];
  const seen = new Set();
  const pattern = /href="([^"]*\/video\/[^"]*)"[^>]*>([^<]+)</gi;
  for (const match of html.matchAll(pattern)) {
    const pageUrl = match[1].startsWith('http') ? match[1] : `https://www.xhamster.com${match[1]}`;
    if (seen.has(pageUrl)) continue;
    seen.add(pageUrl);
    items.push({ pageUrl, title: htmlDecode(match[2]), source: PROVIDER_ID });
  }
  return items;
}

async function resolvePlaylist(url, ctx = {}) {
  const html = await (ctx.fetchHtml || defaultFetch)(url, { timeout: ctx.timeout || 12000 });
  const items = extractPlaylistItems(html);
  return {
    pageUrl: url,
    items,
    total: items.length,
    resolverPath: ['provider', 'xhamster', 'html-playlist']
  };
}

module.exports = {
  id: PROVIDER_ID,
  domains: DOMAINS,
  classifyUrl,
  resolveVideo,
  resolvePlaylist
};