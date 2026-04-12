/**
 * config.js — Monica's Gateway Configuration (flat folder version)
 */

'use strict';

const config = {
  GATEWAY_PORT: parseInt(process.env.GATEWAY_PORT || '4000', 10),

  REPLICAS: [
    process.env.REPLICA1_URL || 'http://localhost:5001',
    process.env.REPLICA2_URL || 'http://localhost:5002',
    process.env.REPLICA3_URL || 'http://localhost:5003',
  ],

  HEARTBEAT_INTERVAL_MS:  parseInt(process.env.HEARTBEAT_INTERVAL_MS  || '2000', 10),
  HEARTBEAT_TIMEOUT_MS:   parseInt(process.env.HEARTBEAT_TIMEOUT_MS   || '1500', 10),
  LEADER_RETRY_ATTEMPTS:  parseInt(process.env.LEADER_RETRY_ATTEMPTS  || '3',    10),
  LEADER_RETRY_DELAY_MS:  parseInt(process.env.LEADER_RETRY_DELAY_MS  || '500',  10),

  RATE_LIMIT_MESSAGES_PER_SECOND: parseInt(process.env.RATE_LIMIT_MSG_PER_SEC || '30', 10),
  RATE_LIMIT_CONNECTIONS_PER_IP:  parseInt(process.env.RATE_LIMIT_CONN_PER_IP || '10', 10),

  ENDPOINTS: {
    HEARTBEAT: '/status',
    APPEND:    '/append-entries',
    VOTE:      '/request-vote',
    SYNC_LOG:  '/sync-log',
  },

  NODE_ENV: process.env.NODE_ENV || 'development',
};

module.exports = config;
