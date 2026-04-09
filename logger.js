/**
 * logger.js — Simple structured logger
 *
 * CLOUD CONCEPT: Observability — in distributed systems, structured
 * logs are essential for debugging across containers.
 * Each log line includes a timestamp and level so Docker log
 * aggregators (ELK, CloudWatch, Datadog) can parse them.
 */

'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'];

function _log(level, ...args) {
  if (LEVELS[level] < CURRENT_LEVEL) return;
  const ts = new Date().toISOString();
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `[${ts}] [${level.toUpperCase()}]`, ...args
  );
}

module.exports = {
  debug: (...a) => _log('debug', ...a),
  info:  (...a) => _log('info',  ...a),
  warn:  (...a) => _log('warn',  ...a),
  error: (...a) => _log('error', ...a),
};
