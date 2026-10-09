FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .
RUN mkdir -p /app/.auth /app/data && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["npm", "start"]
