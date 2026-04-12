/**
 * gateway/server.js — OCP Extension Entry Point
 *
 * This file is NEW (added by extension).
 * It does NOT modify Monica's original flat-folder server.js.
 *
 * Strategy: Copy Monica's original files into this container at build time
 * (see Dockerfile), then start them exactly as-is with the correct env vars
 * pointing at the new replica ports (5001/5002/5003).
 *
 * This file is the Docker CMD target. It simply delegates to Monica's server.
 */

'use strict';

// All original gateway modules are copied into /app/core/ by the Dockerfile.
// We just require Monica's original entry point from that location.
require('/app/core/server');
