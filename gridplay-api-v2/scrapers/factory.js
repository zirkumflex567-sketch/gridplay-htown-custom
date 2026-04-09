'use strict';

const { htmlDecode, normalizeWhitespace, parseViews, parseRatingPercent, makeAbsolute } = require('./shared');

function createScraper({ id, baseUrl, hosts, buildSearchUrl, pattern }) {
  function isLikelyVideoPage(rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (!hosts.includes(u.hostname)) return false;
      const p = u.pathname.toLowerCase();
      if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|woff2?)$/.test(p)) return false;
      return p.includes('/video') || p.includes('/videos') || p.includes('/watch') || p.includes('/hdporn');
    } catch (_) {
      return false;
    }
  }

  return {
    id,
    hosts,
    buildSearchUrl,
    parseSearchResults(html) {
      const out = [];
      const seen = new Set();
      for (const match of html.matchAll(pattern)) {
        const pageUrl = makeAbsolute(baseUrl, htmlDecode(match[1] || ''));
        if (!pageUrl || seen.has(pageUrl) || !isLikelyVideoPage(pageUrl)) continue;
        seen.add(pageUrl);

        const title = normalizeWhitespace(htmlDecode(match[2] || 'Untitled')) || 'Untitled';
        const meta = match[3] || '';
        const parsedViews = parseViews(meta);
        const parsedRating = parseRatingPercent(meta);

        out.push({
          source: id,
          pageUrl,
          title,
          views: parsedViews || 120000,
          rating: parsedRating || 85
        });

        if (out.length >= 60) break;
      }

      if (out.length === 0) {
        const fallbackRegex = /href="([^"]*(?:\/video\/|\/videos\/|\/watch\/|video)[^"]*)"[^>]*?(?:title="([^"]+)")?/gi;
        for (const match of html.matchAll(fallbackRegex)) {
          const pageUrl = makeAbsolute(baseUrl, htmlDecode(match[1] || ''));
          if (!pageUrl || seen.has(pageUrl) || !isLikelyVideoPage(pageUrl)) continue;
          seen.add(pageUrl);
          const title = normalizeWhitespace(htmlDecode(match[2] || `${id} result`));
          out.push({ source: id, pageUrl, title, views: 120000, rating: 85 });
          if (out.length >= 60) break;
        }
      }

      return out;
    }
  };
}

module.exports = { createScraper };
