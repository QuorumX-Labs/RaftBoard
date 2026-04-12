# frontend/Dockerfile — OCP Extension
# Serves the new frontend drawing board on port 8080.
# Does NOT touch DrawSync's frontend/index.html (different service).

FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY index.html ./
COPY server.js  ./

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/ || exit 1

CMD ["node", "server.js"]
