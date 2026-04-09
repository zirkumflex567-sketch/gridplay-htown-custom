'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'pmvhaven',
  baseUrl: 'https://pmvhaven.com',
  hosts: ['pmvhaven.com', 'www.pmvhaven.com'],
  buildSearchUrl: (query, page = 1) => `https://pmvhaven.com/search?q=${encodeURIComponent(query)}&page=${page}`,
  pattern: /<a[^>]+href="(\/video\/[^"]+)"[^>]*>([\s\S]+?)<\/a>/gi,
  durationPattern: />(\d{1,2}:\d{2}(?::\d{2})?)<\/div>/
});
