FROM node:20-alpine

WORKDIR /app

# Install deps first (layer caching)
COPY package.json ./
RUN npm install

# Copy source (bind mount will override in dev)
COPY src/ ./src/

EXPOSE 3001

# nodemon for hot-reload in development
CMD ["npm", "run", "dev"]
