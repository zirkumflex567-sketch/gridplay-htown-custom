'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'hqporner',
  baseUrl: 'https://hqporner.com',
  hosts: ['hqporner.com', 'www.hqporner.com'],
  buildSearchUrl: (query, page = 1) => `https://hqporner.com/?q=${encodeURIComponent(query)}&page=${page}`,
  pattern: /href="([^\"]*\/hdporn\/[^\"]+)"[^>]*title="([^\"]+)"[\s\S]{0,260}?((?:[0-9.,]+\s*[kKmM]?\s*views)|(?:[0-9]{1,3}%))/gi,
  durationPattern: /((?:\d{1,2}:)?\d{1,2}:\d{2})/
});
