FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=optional
COPY . .
RUN npm run build && npm run test:build

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV FIELD_KIT_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data && chmod 0700 /data
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz | grep -q "field kit ok"
CMD ["node", "server/index.mjs"]
