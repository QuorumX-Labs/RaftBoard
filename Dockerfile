# ── Monica's Gateway Dockerfile ──────────────────────────────────────────────
#
# CLOUD CONCEPT: Container security — we follow these practices:
#   1. Use official minimal base image (alpine = smaller attack surface)
#   2. Run as non-root user (principle of least privilege)
#   3. Only COPY what's needed (no secrets, no .env files in image)
#   4. Use specific version tags, not 'latest' (reproducible builds)
#
# CLOUD CONCEPT: ARM64 compatibility — node:18-alpine is a multi-arch
# image that works on both ARM64 (Mac M4) and AMD64 (Intel/AMD servers).
# Docker pulls the correct arch automatically. NO platform: linux/amd64
# needed — that would cause slow emulation on Mac M4.
#
# CLOUD CONCEPT: Docker layer caching — COPY package.json BEFORE
# copying source code. npm install is cached unless package.json
# changes, which makes rebuilds much faster.

FROM node:18-alpine

# CLOUD CONCEPT: Container security — run as non-root.
# If the app is compromised, the attacker only gets user-level access
# inside the container, not root.
RUN addgroup -S gateway && adduser -S gateway -G gateway

WORKDIR /app

# Copy dependency manifest first (layer cache optimization)
COPY package.json ./

# Install only production dependencies (no devDependencies in container)
# CLOUD CONCEPT: Minimal container image = smaller attack surface.
RUN npm install --omit=dev

# Copy application source
COPY websocket_server/ ./websocket_server/
COPY client_manager/   ./client_manager/
COPY config/           ./config/
COPY utils/            ./utils/

# Switch to non-root user
USER gateway

# Expose gateway port
EXPOSE 4000

# CLOUD CONCEPT: Health check built into the image.
# Docker Compose and Kubernetes use this to know if the container
# is ready to accept traffic.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

# Start the gateway
CMD ["node", "websocket_server/server.js"]
