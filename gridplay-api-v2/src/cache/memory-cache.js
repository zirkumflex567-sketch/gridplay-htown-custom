'use strict';

class MemoryCache {
  constructor(defaultTtl = 300000) {
    this.cache = new Map();
    this.defaultTtl = defaultTtl;
  }

  set(key, value, ttl = this.defaultTtl) {
    const expiresAt = Date.now() + ttl;
    this.cache.set(key, { value, expiresAt });
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    this.cleanup();
    return this.cache.size;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

function createCache() {
  return new MemoryCache();
}

const classifierCache = createCache();
const resolveCache = createCache();

function getClassifierCache() {
  return classifierCache;
}

function getResolveCache() {
  return resolveCache;
}

function buildCacheKey(type, url) {
  return `${type}:${url}`;
}

function cachedResolve(url, resolver) {
  const key = buildCacheKey('resolve', url);
  const cached = resolveCache.get(key);
  if (cached) return cached;

  const result = resolver();
  if (result) {
    resolveCache.set(key, result, 120000);
  }
  return result;
}

module.exports = { MemoryCache, createCache, getClassifierCache, getResolveCache, buildCacheKey, cachedResolve };