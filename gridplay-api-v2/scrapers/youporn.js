'use strict';
const { createScraper } = require('./factory');
module.exports = createScraper({
  id: 'youporn',
  baseUrl: 'https://www.youporn.com',
  hosts: ['youporn.com', 'www.youporn.com'],
  buildSearchUrl: (query, page = 1) => `https://www.youporn.com/search/?query=${encodeURIComponent(query)}&page=${page}`,
  pattern: /href="([^\"]*\/watch\/[^\"]+)"[^>]*title="([^\"]+)"[\s\S]{0,300}?((?:[0-9.,]+\s*[kKmM]?\s*views)|(?:[0-9]{1,3}%))/gi
});
