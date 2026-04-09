'use strict';

const { htmlDecode } = require('../../scrapers/shared');

const PROVIDER_ID = 'spankbang';
const DOMAINS = ['spankbang.com', 'www.spankbang.com', 'spankbang.party', 'spankbang.kim', 'spankbang.porn'];

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
    return { kind: 'playlist', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.9, signals: ['spankbang-playlist-path'] };
  }
  if (pathname.includes('/video') || pathname.match(/^\/[a-z0-9_]+\/video$/)) {
    return { kind: 'video', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.9, signals: ['spankbang-video-path'] };
  }
  if (pathname.includes('/profile') || pathname.includes('/model')) {
    return { kind: 'profile', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.85, signals: ['spankbang-profile-path'] };
  }
  if (pathname.includes('/search') || search.includes('q=') || search.includes('s=')) {
    return { kind: 'search', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.8, signals: ['spankbang-search-path'] };
  }

  return { kind: 'unknown', providerId: PROVIDER_ID, canonicalUrl: url, confidence: 0.3, signals: ['spankbang-unknown-path'] };
}

async function resolveVideo(url, ctx = {}) {
  const { fetchHtml = defaultFetch, timeout = 12000 } = ctx;

  const tryResolve = async (targetUrl) => {
    const html = await fetchHtml(targetUrl, { timeout });
    const candidates = collectMediaCandidates(html);
    const best = pickBestMedia(candidates);

    return {
      pageUrl: targetUrl,
      mediaUrl: best.url,
      mediaType: best.mediaType,
      streamUrl: `/gridplay-api-v2/stream?url=${encodeURIComponent(best.url)}`,
      title: extractTitle(html),
      durationSeconds: extractDuration(html),
      source: PROVIDER_ID,
      resolverPath: ['provider', 'spankbang']
    };
  };

  try {
    return await tryResolve(url);
  } catch (error) {
    // If the main domain failed, try mirrors
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('.com')) {
      const mirrors = ['spankbang.party', 'spankbang.kim'];
      for (const mirror of mirrors) {
        try {
          const mirrorUrl = url.replace(parsed.hostname, mirror);
          console.log(`Retrying SpankBang with mirror: ${mirrorUrl}`);
          return await tryResolve(mirrorUrl);
        } catch (_) {
          continue;
        }
      }
    }
    throw error;
  }
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
  // 1. Try meta property og:video:duration (seconds)
  const metaMatch = html.match(/<meta\s+property="og:video:duration"\s+content="(\d+)"/i);
  if (metaMatch) return parseInt(metaMatch[1], 10);

  // 2. Try datatestid video-item-length (e.g. "4m", "1h 5m")
  const testIdMatch = html.match(/data-testid="video-item-length"[^>]*>([\s\S]+?)<\/div>/i);
  if (testIdMatch) {
    const text = testIdMatch[1].trim().toLowerCase();
    let total = 0;
    const h = text.match(/(\d+)h/);
    const m = text.match(/(\d+)m/);
    const s = text.match(/(\d+)s/);
    if (h) total += parseInt(h[1], 10) * 3600;
    if (m) total += parseInt(m[1], 10) * 60;
    if (s) total += parseInt(s[1], 10);
    if (total > 0) return total;
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

module.exports = { id: PROVIDER_ID, domains: DOMAINS, classifyUrl, resolveVideo };