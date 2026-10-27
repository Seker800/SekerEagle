FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY apps/compute-coordinator/fleet.mjs apps/compute-coordinator/server.mjs apps/compute-coordinator/main.mjs ./
COPY packages/media-core/stream-fetch.cjs /packages/media-core/stream-fetch.cjs
USER node
CMD ["node", "main.mjs", "serve"]
