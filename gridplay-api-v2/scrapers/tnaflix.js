'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'tnaflix',
  baseUrl: 'https://www.tnaflix.com',
  hosts: ['tnaflix.com', 'www.tnaflix.com'],
  buildSearchUrl: (query, page = 1) => `https://www.tnaflix.com/search/${encodeURIComponent(query)}/${page}/`,
  pattern: /href="([^\"]*\/video[^\"]+)"[^>]*title="([^\"]+)"[\s\S]{0,260}?((?:[0-9.,]+\s*[kKmM]?\s*views)|(?:[0-9]{1,3}%))/gi,
  durationPattern: /((?:\d{1,2}:)?\d{1,2}:\d{2})/
});
