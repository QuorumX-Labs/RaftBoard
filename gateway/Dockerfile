# gateway/Dockerfile — OCP Extension
#
# This Dockerfile is NEW.
# It does NOT modify Monica's original Dockerfile (which lives at
# RaftBoard-main/Dockerfile and expects a different folder layout).
#
# Strategy:
#   1. Copy Monica's original flat-folder source files (server.js, config.js,
#      leaderManager.js, etc.) into /app/core/ — untouched, byte-for-byte.
#   2. Install dependencies from Monica's original package.json.
#   3. Set CMD to node /app/core/server.js so Monica's code runs as-is.
#   4. nodemon watches /app/core for hot-reload during development.

FROM node:18-alpine

RUN addgroup -S gateway && adduser -S gateway -G gateway

WORKDIR /app

# Install nodemon for hot-reload
RUN npm install -g nodemon

# Copy Monica's original package.json to resolve deps
COPY core/package.json ./package.json
RUN npm install --omit=dev

# Copy Monica's original source files verbatim into /app/core/
COPY core/ ./core/

USER gateway

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

# Run Monica's original server.js directly — no wrapper needed
CMD ["node", "core/server.js"]
