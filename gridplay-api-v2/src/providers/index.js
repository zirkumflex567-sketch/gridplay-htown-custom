'use strict';

const { createProviderRegistry } = require('./registry');
const { classifyUrl } = require('./registry');

const pmvhavenProvider = require('./pmvhaven.provider');
const xvideosProvider = require('./xvideos.provider');
const xhamsterProvider = require('./xhamster.provider');
const youpornProvider = require('./youporn.provider');
const epornerProvider = require('./eporner.provider');
const tnaflixProvider = require('./tnaflix.provider');
const xnxxProvider = require('./xnxx.provider');
const pornhubProvider = require('./pornhub.provider');
const spankbangProvider = require('./spankbang.provider');
const genericProvider = require('./generic.provider');

const allProviders = [
  pmvhavenProvider,
  xvideosProvider,
  xhamsterProvider,
  youpornProvider,
  epornerProvider,
  tnaflixProvider,
  xnxxProvider,
  pornhubProvider,
  spankbangProvider,
  genericProvider
];

const providerRegistry = createProviderRegistry(allProviders);

function getProviderRegistry() {
  return providerRegistry;
}

function getAllProviders() {
  return providerRegistry.getAll();
}

function getProviderByDomain(domain) {
  return providerRegistry.getByDomain(domain);
}

function getProviderById(id) {
  return providerRegistry.getById(id);
}

function classifyUrlWithRegistry(url) {
  return classifyUrl(url, providerRegistry);
}

function getSupportedDomains() {
  return providerRegistry.getSupportedDomains();
}

module.exports = {
  getProviderRegistry,
  getAllProviders,
  getProviderByDomain,
  getProviderById,
  classifyUrlWithRegistry,
  getSupportedDomains
};