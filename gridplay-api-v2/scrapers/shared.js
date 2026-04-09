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

function makeAbsolute(base, href) {
  try {
    return new URL(href, base).toString();
  } catch (_) {
    return null;
  }
}

function scoreVideo(video, minViews, minRating) {
  const views = Number(video.views || 0);
  const rating = Number(video.rating || 0);
  return views >= minViews && rating >= minRating ? rating * 100000 + views : -1;
}

module.exports = { htmlDecode, normalizeWhitespace, parseViews, parseRatingPercent, makeAbsolute, scoreVideo };
