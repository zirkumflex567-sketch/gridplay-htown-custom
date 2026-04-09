'use strict';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] < currentLevel) return;
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...meta };
  console.log(JSON.stringify(entry));
}

const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),

  logResolve: (url, result, durationMs) => {
    log('info', 'Resolve completed', { url, success: !!result?.mediaUrl, durationMs, source: result?.source });
  },
  logResolveError: (url, error, step) => {
    log('error', 'Resolve failed', { url, error: error.message, step });
  },
  logClassifier: (url, classification) => {
    log('debug', 'URL classified', { url, kind: classification.kind, providerId: classification.providerId, confidence: classification.confidence });
  }
};

module.exports = { logger, LOG_LEVELS };