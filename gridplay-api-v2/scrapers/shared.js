'use strict';

function htmlDecode(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/');
}

function normalizeWhitespace(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function parseViews(input = '') {
  const clean = normalizeWhitespace(input).toLowerCase().replace(/,/g, '');
  const m = clean.match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])?/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  if (m[2] === 'k') return Math.round(n * 1000);
  if (m[2] === 'm') return Math.round(n * 1000000);
  if (m[2] === 'b') return Math.round(n * 1000000000);
  return Math.round(n);
}

function parseRatingPercent(input = '') {
  const m = String(input).match(/([0-9]{1,3})(?:\.[0-9]+)?\s*%?/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function parseDuration(input = '') {
  if (!input) return 0;
  const clean = normalizeWhitespace(input).toLowerCase();
  
  // Format MM:SS, H:MM:SS
  const hms = clean.match(/(?:(\d+):)?(\d+):(\d+)/);
  if (hms) {
    const h = parseInt(hms[1] || 0, 10);
    const m = parseInt(hms[2] || 0, 10);
    const s = parseInt(hms[3] || 0, 10);
    return (h * 3600) + (m * 60) + s;
  }

  // Format "3 min", "12 sec", "1h 5m"
  let total = 0;
  const hMatch = clean.match(/(\d+)\s*h/);
  const mMatch = clean.match(/(\d+)\s*m/);
  const sMatch = clean.match(/(\d+)\s*s/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 3600;
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  if (sMatch) total += parseInt(sMatch[1], 10);
  
  return total;
}

function makeAbsolute(base, href) {
  try {
    return new URL(href, base).toString();
  } catch (_) {
    return null;
  }
}

function scoreVideo(video, minViews, minRating, minDuration = 0) {
  const views = Number(video.views || 0);
  const rating = Number(video.rating || 0);
  const duration = Number(video.duration || 0);
  
  if (views < minViews || rating < minRating || duration < minDuration) return -1;
  return rating * 100000 + views;
}

const MIN_VIDEO_DURATION = 60;

module.exports = { 
  htmlDecode, 
  normalizeWhitespace, 
  parseViews, 
  parseRatingPercent, 
  parseDuration, 
  makeAbsolute, 
  scoreVideo,
  MIN_VIDEO_DURATION 
};
