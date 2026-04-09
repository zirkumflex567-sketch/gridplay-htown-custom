'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'xvideos',
  baseUrl: 'https://www.xvideos.com',
  hosts: ['xvideos.com', 'www.xvideos.com'],
  buildSearchUrl: (query, page = 1) => `https://www.xvideos.com/?k=${encodeURIComponent(query)}&p=${Math.max(0, page - 1)}`,
  pattern: /href="([^\"]*video[^\"]*)"[^>]*title="([^\"]+)"[\s\S]{0,280}?((?:[0-9.,]+\s*[kKmM]?\s*views)|(?:[0-9]{1,3}%))/gi
});
