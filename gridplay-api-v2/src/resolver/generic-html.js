'use strict';

const { htmlDecode, normalizeWhitespace } = require('../../scrapers/shared');

function extractMediaCandidates(html) {
  const normalized = htmlDecode(html || '');
  const results = [];
  const seen = new Set();

  const patterns = [
    /https:\/\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?/gi,
    /https:\/\/[^"'\s<>]+?\.m3u8(?:\?[^"'\s<>]*)?/gi,
    /"contentUrl"\s*:\s*"([^"]+)"/gi,
    /"videoUrl"\s*:\s*"([^"]+)"/gi,
    /videoUrl\s*[=:]\s*['"]([^'"]+)['"]/gi
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const raw = htmlDecode(match[1] || match[0]);
      if (!raw || !raw.startsWith('http')) continue;
      if (seen.has(raw)) continue;

      const isMp4 = raw.includes('.mp4');
      const isM3u8 = raw.includes('.m3u8');
      if (!isMp4 && !isM3u8) continue;

      seen.add(raw);
      results.push(raw);
    }
  }

  return results;
}

function pickBestMediaUrl(candidates) {
  if (!candidates || candidates.length === 0) return null;
  return candidates
    .map((url) => {
      const qualityMatch = url.toLowerCase().match(/(2160|1440|1080|720|480|360|240)p/);
      const quality = qualityMatch ? Number(qualityMatch[1]) : 0;
      const score = (url.includes('.mp4') ? 10000 : 0) + quality;
      return { url, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.url || null;
}

function extractTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? htmlDecode(normalizeWhitespace(match[1]).replace(/\s*[-|].*$/, '')) : null;
}

function extractDuration(html) {
  const match = html.match(/(\d{2}):(\d{2}):(\d{2})/) || html.match(/(\d+):(\d+)/);
  if (match) {
    if (match.length === 4) {
      return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
    }
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }
  return null;
}

module.exports = {
  extractMediaCandidates,
  pickBestMediaUrl,
  extractTitle,
  extractDuration
};