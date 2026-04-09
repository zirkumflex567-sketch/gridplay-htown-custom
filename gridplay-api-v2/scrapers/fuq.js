'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'fuq',
  baseUrl: 'https://www.fuq.com',
  hosts: ['fuq.com', 'www.fuq.com'],
  buildSearchUrl: (query, page = 1) => `https://www.fuq.com/search/${encodeURIComponent(query)}/${page}/`,
  pattern: /href="([^\"]*\/video\/[0-9]+\/[^\"]+)"[^>]*title="([^\"]+)"[\s\S]{0,260}?((?:[0-9.,]+\s*[kKmM]?\s*views)|(?:[0-9]{1,3}%))/gi
});
