'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'eporner',
  baseUrl: 'https://www.eporner.com',
  hosts: ['eporner.com', 'www.eporner.com'],
  buildSearchUrl: (query, page = 1) => `https://www.eporner.com/search/${encodeURIComponent(query)}/${page}/`,
  pattern: /href="([^\"]*\/video-[^\"]+)"[^>]*title="([^\"]+)"[\s\S]{0,260}?((?:[0-9.,]+\s*[kKmM]?\s*views)|(?:[0-9]{1,3}%))/gi
});
