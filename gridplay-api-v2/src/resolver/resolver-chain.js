'use strict';

const { classifyUrlWithRegistry, getProviderByDomain, getProviderById } = require('../providers');
const { MIN_VIDEO_DURATION } = require('../../scrapers/shared');

const DEFAULT_TIMEOUT = 12000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_DELAYS = [250, 750];

function withRetry(fn, options = {}) {
  const { maxRetries = DEFAULT_MAX_RETRIES, delays = RETRY_DELAYS, onRetry } = options;

  return async function (...args) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries && isRetryableError(error)) {
          if (onRetry) onRetry(error, attempt + 1);
          if (delays[attempt]) await sleep(delays[attempt]);
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  };
}

function isRetryableError(error) {
  if (!error) return false;
  const message = error.message || '';
  const isNetworkError = message.includes('fetch') || message.includes('network') || message.includes('ECONNREFUSED');
  const isTimeout = message.includes('timeout') || message.includes('AbortSignal');
  const is5xx = /5\d{2}/.test(message);
  return isNetworkError || isTimeout || is5xx;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveWithProvider(url, provider, ctx) {
  const { fetchHtml, timeout = DEFAULT_TIMEOUT } = ctx;
  const fetchFn = fetchHtml || defaultFetch;

  if (provider.resolveVideo) {
    return await provider.resolveVideo(url, { ...ctx, fetchHtml: fetchFn, timeout });
  }
  throw new Error(`Provider ${provider.id} does not support resolveVideo`);
}

async function resolveWithGenericHtml(url, ctx) {
  const { fetchHtml, timeout = DEFAULT_TIMEOUT } = ctx;
  const fetchFn = fetchHtml || defaultFetch;

  const html = await fetchFn(url, { timeout });
  const { extractMediaCandidates, pickBestMediaUrl } = require('../resolver/generic-html');
  const candidates = extractMediaCandidates(html);
  const best = pickBestMediaUrl(candidates);

  if (!best) throw new Error('No media found via generic extraction');

  return {
    pageUrl: url,
    mediaUrl: best,
    mediaType: best.includes('.m3u8') ? 'm3u8' : 'mp4',
    streamUrl: `/gridplay-api-v2/stream?url=${encodeURIComponent(best)}`,
    source: 'generic-html',
    resolverPath: ['generic-html']
  };
}

async function resolveWithEmbedFallback(url, ctx) {
  return {
    pageUrl: url,
    mediaUrl: url,
    mediaType: 'embed',
    streamUrl: url,
    source: 'embed-fallback',
    resolverPath: ['embed-fallback']
  };
}

async function resolveWithUnknownFallback(url, ctx) {
  return {
    pageUrl: url,
    mediaUrl: null,
    mediaType: 'unknown',
    streamUrl: null,
    source: 'unknown-fallback',
    resolverPath: ['unknown-fallback'],
    error: 'No resolver could extract playable media'
  };
}

async function defaultFetch(url, options = {}) {
  const isSpankBang = url.includes('spankbang');
  const cookies = (isSpankBang && process.env.SB_COOKIE) || process.env.GLOBAL_COOKIE || '';

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cookie': cookies,
      ...options.headers
    },
    signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} (Resolution Failed)`);
  return response.text();
}

async function resolveUrl(url, options = {}) {
  const { 
    fetchHtml, 
    timeout = DEFAULT_TIMEOUT, 
    maxRetries = DEFAULT_MAX_RETRIES,
    useProviderFallback = true,
    useGenericHtmlFallback = true,
    useEmbedFallback = true
  } = options;

  const ctx = { fetchHtml, timeout };
  const classification = classifyUrlWithRegistry(url);

  const provider = classification.providerId 
    ? getProviderById(classification.providerId) 
    : getProviderByDomain(new URL(url).hostname);

  if (provider) {
    const tryProvider = withRetry(
      (u) => resolveWithProvider(u, provider, ctx),
      { 
        maxRetries, 
        onRetry: (err, attempt) => console.warn(`Provider retry ${attempt}: ${err.message}`) 
      }
    );

    try {
      const result = await tryProvider(url);
      return enforceDurationBarrier({
        ...result,
        classification
      });
    } catch (error) {
      console.warn(`Provider ${provider.id} failed: ${error.message}`);
      if (!useProviderFallback) throw error;
    }
  }

  if (useGenericHtmlFallback) {
    const tryGeneric = withRetry(
      (u) => resolveWithGenericHtml(u, ctx),
      { 
        maxRetries, 
        onRetry: (err, attempt) => console.warn(`Generic HTML retry ${attempt}: ${err.message}`) 
      }
    );

    try {
      const result = await tryGeneric(url);
      return enforceDurationBarrier({
        ...result,
        classification
      });
    } catch (error) {
      console.warn(`Generic HTML fallback failed: ${error.message}`);
    }
  }

  if (useEmbedFallback) {
    try {
      const result = await resolveWithEmbedFallback(url, ctx);
      return { ...result, classification };
    } catch (error) {
      console.warn(`Embed fallback failed: ${error.message}`);
    }
  }

  const result = await resolveWithUnknownFallback(url, ctx);
  return enforceDurationBarrier({ ...result, classification });
}

function enforceDurationBarrier(result) {
  if (result && result.mediaUrl && result.durationSeconds !== undefined && result.durationSeconds !== null) {
    if (result.durationSeconds < MIN_VIDEO_DURATION) {
      console.warn(`Blocking short content: ${result.durationSeconds}s (< ${MIN_VIDEO_DURATION}s) for ${result.pageUrl}`);
      return {
        ...result,
        mediaUrl: null,
        streamUrl: null,
        error: `Content too short (${result.durationSeconds}s). Minimum allowed is ${MIN_VIDEO_DURATION}s.`,
        classification: { ...result.classification, signals: [...(result.classification?.signals || []), 'blocked-short-content'] }
      };
    }
  }
  return result;
}

module.exports = {
  resolveUrl,
  withRetry,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_RETRIES
};