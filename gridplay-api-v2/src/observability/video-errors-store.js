'use strict';

const fs = require('fs');
const path = require('path');

const VIDEO_ERRORS_FILE = process.env.VIDEO_ERRORS_FILE || path.join(__dirname, '../../../video_errors.jsonl');

const errors = [];
const MAX_ERRORS = 1000;

function logError(entry) {
  const errorEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  
  errors.push(errorEntry);
  if (errors.length > MAX_ERRORS) {
    errors.shift();
  }

  try {
    const line = JSON.stringify(errorEntry) + '\n';
    fs.appendFileSync(VIDEO_ERRORS_FILE, line);
  } catch (e) {
    console.error('Failed to write to video_errors file:', e.message);
  }

  return errorEntry;
}

function recordError({ url, error, code, providerId, step, attempt }) {
  return logError({
    url,
    error: error?.message || error,
    code: code || 'E_UNKNOWN',
    providerId,
    step,
    attempt
  });
}

function getRecentErrors(limit = 100) {
  return errors.slice(-limit);
}

function clearErrors() {
  errors.length = 0;
}

module.exports = { recordError, getRecentErrors, clearErrors };