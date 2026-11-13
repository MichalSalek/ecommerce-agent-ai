FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG EMBEDDING_MODEL=minilm
ENV EMBEDDING_MODEL=${EMBEDDING_MODEL}
ENV EMBEDDING_CACHE_DIR=/app/.data/models LANCEDB_DIR=/app/.data/lancedb
RUN npm run catalog:prepare && npm run build && node scripts/prune-runtime.mjs .next/standalone

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=10000 HOSTNAME=0.0.0.0
ENV NODE_OPTIONS=--max-old-space-size=256
ARG APP_REVISION=local
ENV APP_REVISION=${APP_REVISION}
ARG EMBEDDING_MODEL=minilm
ENV EMBEDDING_MODEL=${EMBEDDING_MODEL}
ENV EMBEDDING_CACHE_DIR=/app/.data/models LANCEDB_DIR=/app/.data/lancedb
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.data ./.data
USER node
EXPOSE 10000
CMD ["node", "server.js"]
