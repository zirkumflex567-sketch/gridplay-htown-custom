'use strict';

const { htmlDecode, normalizeWhitespace, parseViews, parseRatingPercent, parseDuration, makeAbsolute } = require('./shared');

function createScraper({ id, baseUrl, hosts, buildSearchUrl, pattern, durationPattern }) {
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

        let title = 'Result';
        let meta = match[3] || '';

        // If Group 2 is a chunk of HTML (like with my new pmvhaven regex), extract title from it
        const inner = match[2] || '';
        if (inner.includes('<')) {
          const hMatch = inner.match(/<h[1-6][^>]*>([\s\S]+?)<\/h[1-6]>/i);
          const altMatch = inner.match(/alt="([^"]+)"/i);
          const titleAttrMatch = inner.match(/title="([^"]+)"/i);
          const spanMatch = inner.match(/<(?:span|div|a)[^>]*>([\s\S]+?)<\/(?:span|div|a)>/i);
          
          if (hMatch) title = hMatch[1];
          else if (altMatch) title = altMatch[1];
          else if (titleAttrMatch) title = titleAttrMatch[1];
          else if (spanMatch) title = spanMatch[1];
          else title = inner;
          
          if (!meta) meta = inner; 
        } else {
          title = inner;
        }

        title = normalizeWhitespace(htmlDecode(title)).replace(/<[^>]+>/g, '').trim() || 'Untitled';
        
        // Better meta search: find chunks containing views or rating or percentages
        let parsedViews = parseViews(meta);
        let parsedRating = parseRatingPercent(meta);

        if (inner.includes('<')) {
           // Try to find specific tags for views/rating if the generic parse failed
           const viewsMatch = meta.match(/>([0-9.,]+\s*[kKmM]?)\s*</);
           if (!parsedViews && viewsMatch) parsedViews = parseViews(viewsMatch[1]);
           
           const ratingMatch = meta.match(/>([0-9.]+\s*%)\s*</);
           if (!parsedRating && ratingMatch) parsedRating = parseRatingPercent(ratingMatch[1]);
        }

        // Try to find duration in meta first, then apply scraper-specific pattern
        let duration = parseDuration(meta);
        if (!duration && durationPattern) {
          const durMatch = meta.match(durationPattern);
          if (durMatch) duration = parseDuration(durMatch[1] || durMatch[0]);
        }

        out.push({
          source: id,
          pageUrl,
          title,
          views: parsedViews || 120000,
          rating: parsedRating || 85,
          duration: duration || 0
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
