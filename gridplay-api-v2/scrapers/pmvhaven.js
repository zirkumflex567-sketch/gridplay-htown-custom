'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'pmvhaven',
  baseUrl: 'https://pmvhaven.com',
  hosts: ['pmvhaven.com', 'www.pmvhaven.com'],
  buildSearchUrl: (query, page = 1) => `https://pmvhaven.com/search?query=${encodeURIComponent(query)}&page=${page}`,
  pattern: /href="(\/video\/[a-zA-Z0-9-]+)"[^>]*>([^<]+)<[\s\S]{0,220}?((?:[0-9.,]+\s*[kKmM]?\s*views)|(?:[0-9]{1,3}%))/gi
});
