'use strict';

const URL_KINDS = ['video', 'playlist', 'profile', 'search', 'unknown'];
const MEDIA_TYPES = ['mp4', 'm3u8', 'embed', 'unknown'];
const RESOLVER_STEPS = ['provider', 'generic-html', 'embed-fallback', 'unknown-fallback'];
const PROVIDER_STATUS = ['done', 'partial', 'blocked'];

const ERROR_CODES = {
  E_PROVIDER_UNSUPPORTED: 'E_PROVIDER_UNSUPPORTED',
  E_RESOLVE_EMPTY: 'E_RESOLVE_EMPTY',
  E_HTTP_403: 'E_HTTP_403',
  E_HTTP_404: 'E_HTTP_404',
  E_HTTP_5XX: 'E_HTTP_5XX',
  E_TIMEOUT: 'E_TIMEOUT',
  E_PARSE_ERROR: 'E_PARSE_ERROR',
  E_NETWORK_ERROR: 'E_NETWORK_ERROR'
};

module.exports = {
  URL_KINDS,
  MEDIA_TYPES,
  RESOLVER_STEPS,
  PROVIDER_STATUS,
  ERROR_CODES
};