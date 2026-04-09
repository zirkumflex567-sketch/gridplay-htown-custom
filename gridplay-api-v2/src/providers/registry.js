'use strict';

const { URL_KINDS } = require('./provider-types');

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.domainToProvider = new Map();
  }

  register(provider) {
    if (!provider.id || !provider.domains || !Array.isArray(provider.domains)) {
      throw new Error('Provider must have id and domains array');
    }

    for (const domain of provider.domains) {
      const normalizedDomain = domain.toLowerCase();
      if (this.domainToProvider.has(normalizedDomain)) {
        console.warn(`Domain ${normalizedDomain} already registered, replacing`);
      }
      this.domainToProvider.set(normalizedDomain, provider.id);
    }

    this.providers.set(provider.id, provider);
  }

  getByDomain(domain) {
    const normalized = domain.toLowerCase();
    const providerId = this.domainToProvider.get(normalized);
    if (!providerId) return null;
    return this.providers.get(providerId);
  }

  getById(id) {
    return this.providers.get(id);
  }

  getAll() {
    return Array.from(this.providers.values());
  }

  hasDomain(domain) {
    return this.domainToProvider.has(domain.toLowerCase());
  }

  getSupportedDomains() {
    return Array.from(this.domainToProvider.keys());
  }
}

function createProviderRegistry(providers = []) {
  const registry = new ProviderRegistry();
  for (const provider of providers) {
    registry.register(provider);
  }
  return registry;
}

function classifyUrl(url, registry) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return {
      kind: URL_KINDS[4],
      providerId: null,
      canonicalUrl: url,
      confidence: 0,
      signals: ['invalid-url']
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();

  const provider = registry.getByDomain(hostname);

  if (provider && typeof provider.classifyUrl === 'function') {
    const result = provider.classifyUrl(url);
    if (result && result.kind) {
      return result;
    }
  }

  const signals = [`host:${hostname}`];

  const isVideo = /\/video[\/]?[a-zA-Z0-9-]*$/i.test(pathname) ||
                  /\/watch\//i.test(pathname) ||
                  /\/v\/[a-zA-Z0-9]+/i.test(pathname) ||
                  /\.mp4/i.test(pathname) ||
                  /\.m3u8/i.test(pathname);

  const isPlaylist = /\/playlist/i.test(pathname) ||
                     /list=/i.test(search) ||
                     /\/playlists\//i.test(pathname);

  const isProfile = /\/users?\//i.test(pathname) ||
                    /\/model\//i.test(pathname) ||
                    /\/channel\//i.test(pathname) ||
                    /\/profile/i.test(pathname);

  const isSearch = /\/search/i.test(pathname) ||
                   /\/find/i.test(pathname) ||
                   /[?&](q|k|query)=/i.test(search);

  if (isPlaylist) {
    return { kind: 'playlist', providerId: provider?.id || null, canonicalUrl: url, confidence: 0.9, signals: [...signals, 'path:playlist'] };
  }
  if (isVideo) {
    return { kind: 'video', providerId: provider?.id || null, canonicalUrl: url, confidence: 0.85, signals: [...signals, 'path:video'] };
  }
  if (isProfile) {
    return { kind: 'profile', providerId: provider?.id || null, canonicalUrl: url, confidence: 0.8, signals: [...signals, 'path:profile'] };
  }
  if (isSearch) {
    return { kind: 'search', providerId: provider?.id || null, canonicalUrl: url, confidence: 0.8, signals: [...signals, 'path:search'] };
  }

  return {
    kind: URL_KINDS[4],
    providerId: provider?.id || null,
    canonicalUrl: url,
    confidence: 0.3,
    signals: [...signals, 'no-match']
  };
}

module.exports = {
  ProviderRegistry,
  createProviderRegistry,
  classifyUrl
};