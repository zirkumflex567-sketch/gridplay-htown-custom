'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'xhamster',
  baseUrl: 'https://xhamster.com',
  hosts: ['xhamster.com', 'www.xhamster.com'],
  buildSearchUrl: (query, page = 1) => `https://xhamster.com/search/${encodeURIComponent(query)}?page=${page}`,
  pattern: /href="([^\"]*\/videos\/[^\"]+)"[^>]*title="([^\"]+)"[\s\S]{0,300}?((?:[0-9.,]+\s*[kKmM]?\s*views)|(?:[0-9]{1,3}%))/gi
});
