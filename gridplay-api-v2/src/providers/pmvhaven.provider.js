'use strict';

const { htmlDecode } = require('../../scrapers/shared');

const PROVIDER_ID = 'pmvhaven';
const DOMAINS = ['pmvhaven.com', 'www.pmvhaven.com'];
const MEDIA_HOSTS = new Set(['video.pmvhaven.com']);

function validateMediaUrl(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const isArchiveHost = host === 'archive.org' || host.endsWith('.archive.org');
  if (!MEDIA_HOSTS.has(host) && !isArchiveHost) {
    throw new Error('Media host not allowlisted');
  }
  return parsed;
}

function normalizeEscapes(value) {
  return value
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

function extractResolution(urlText) {
  const explicitMatches = [...urlText.matchAll(/(?:^|[^0-9])(2160|1440|1080|720|480|360|240|144)p(?:[^0-9]|$)/gi)];
  if (explicitMatches.length > 0) {
    return Number(explicitMatches[0][1]);
  }
  const dimensions = [...urlText.matchAll(/(\d{3,4})x(\d{3,4})/gi)];
  if (dimensions.length > 0) {
    const heights = dimensions
      .map(match => Number(match[2]))
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
    if (heights.length > 0) return heights[0];
  }
  return 0;
}

function getMediaType(parsedUrl) {
  const path = parsedUrl.pathname.toLowerCase();
  if (path.endsWith('.mp4')) return 'mp4';
  if (path.endsWith('.m3u8')) return 'm3u8';
  return 'other';
}

function collectMediaCandidates(html) {
  const normalizedHtml = normalizeEscapes(html);
  const rawMatches = normalizedHtml.match(/https:\/\/video\.pmvhaven\.com\/[\w\-./%?=&#+:,;~]+/gi) || [];
  const candidates = [];
  const seen = new Set();

  for (const raw of rawMatches) {
    try {
      const parsed = validateMediaUrl(raw);
      const mediaType = getMediaType(parsed);
      if (mediaType === 'other') continue;

      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      candidates.push({
        url: normalized,
        resolution: extractResolution(normalized),
        mediaType,
        progressiveScore: mediaType === 'mp4' ? 1 : 0
      });
    } catch (_) {
      continue;
    }
  }
  return candidates;
}

function sortMediaCandidates(candidates) {
  candidates.sort((a, b) => {
    if (b.progressiveScore !== a.progressiveScore) return b.progressiveScore - a.progressiveScore;
    if (b.resolution !== a.resolution) return b.resolution - a.resolution;
    return a.url.localeCompare(b.url);
  });
}

function pickBestMedia(candidates) {
  if (candidates.length === 0) {
    throw new Error('No media URL found');
  }
  sortMediaCandidates(candidates);
  return candidates[0];
}

function extractNuxtPayloadArray(html) {
  const matched = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!matched || !matched[1]) return null;
  try {
    const parsed = JSON.parse(matched[1]);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function dereferenceNuxtValue(table, maybeRef) {
  if (typeof maybeRef === 'number' && Number.isInteger(maybeRef) && maybeRef >= 0 && maybeRef < table.length) {
    return table[maybeRef];
  }
  return maybeRef;
}

function extractPlaylistItemsFromNuxt(payloadArray) {
  if (!Array.isArray(payloadArray) || payloadArray.length < 2) return [];
  const items = [];
  const seen = new Set();

  for (let i = 1; i < payloadArray.length; i++) {
    const item = payloadArray[i];
    if (!item || typeof item !== 'object') continue;
    if (!item.url && !item.slug && !item.id) continue;

    const url = item.url || (item.slug ? `/video/${item.slug}` : `/video/${item.id}`);
    if (seen.has(url)) continue;
    seen.add(url);

    const title = item.title || item.name || 'Untitled';
    const thumb = item.thumbnail || item.thumb || item.preview || '';
    const duration = item.duration || 0;
    items.push({ url: `https://pmvhaven.com${url}`, title, thumbnail: thumb, duration });
  }
  return items;
}

function classifyUrl(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const isVideo = pathname.includes('/video') || pathname.includes('/videos');
  const isPlaylist = pathname.includes('/playlist') || pathname.includes('/playlists');

  if (isPlaylist) {
    return { kind: 'playlist', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.95, signals: ['pmvhaven-playlist-path'] };
  }
  if (isVideo) {
    return { kind: 'video', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.95, signals: ['pmvhaven-video-path'] };
  }

  return { kind: 'unknown', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.3, signals: ['pmvhaven-unknown-path'] };
}

async function resolveVideo(url, ctx = {}) {
  const { fetchHtml = defaultFetch, timeout = 12000 } = ctx;

  try {
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
      resolverPath: ['provider', 'pmvhaven']
    };
  } catch (error) {
    throw error;
  }
}

async function resolvePlaylist(url, ctx = {}) {
  const { fetchHtml = defaultFetch, timeout = 12000 } = ctx;

  const html = await fetchHtml(url, { timeout });
  const payload = extractNuxtPayloadArray(html);
  const items = extractPlaylistItemsFromNuxt(payload);

  return {
    pageUrl: url,
    items: items.map(item => ({
      pageUrl: item.url,
      title: item.title,
      thumbnail: item.thumbnail,
      duration: item.duration,
      source: PROVIDER_ID
    })),
    total: items.length,
    resolverPath: ['provider', 'pmvhaven', 'nuxt-playlist']
  };
}

async function defaultFetch(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'GridPlayV2/2.0 (+https://h-town.duckdns.org/gridplay/v2/)',
      'Accept': 'text/html,application/xhtml+xml',
      ...options.headers
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
  // 1. Try HH:MM:SS
  const hms = html.match(/(?:^|[^0-9])(\d{1,2}):(\d{2}):(\d{2})(?:[^0-9]|$)/);
  if (hms) {
    return parseInt(hms[1], 10) * 3600 + parseInt(hms[2], 10) * 60 + parseInt(hms[3], 10);
  }
  // 2. Try MM:SS
  const ms = html.match(/(?:^|[^0-9])(\d{1,2}):(\d{2})(?:[^0-9]|$)/);
  if (ms) {
    return parseInt(ms[1], 10) * 60 + parseInt(ms[2], 10);
  }
  return null;
}

module.exports = {
  id: PROVIDER_ID,
  domains: DOMAINS,
  classifyUrl,
  resolveVideo,
  resolvePlaylist
};