FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /sekereagle
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/eagle-filter-core/package.json packages/eagle-filter-core/package.json
COPY packages/vector-core/package.json packages/vector-core/package.json
RUN npm install --global npm@10.9.4 && npm ci
COPY apps/api/prisma apps/api/prisma
COPY apps/worker apps/worker
COPY packages/config packages/config
COPY packages/vector-core packages/vector-core
RUN npm run db:generate && npm run build --workspace @sekereagle/config && npm run build --workspace @sekereagle/vector-core && npm run build --workspace @sekereagle/worker

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg libheif-examples openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /sekereagle
COPY --from=build /sekereagle/node_modules ./node_modules
COPY --from=build /sekereagle/apps/worker/dist ./apps/worker/dist
COPY --from=build /sekereagle/packages/config ./packages/config
COPY --from=build /sekereagle/packages/vector-core ./packages/vector-core
COPY package.json package-lock.json ./
USER node
CMD ["node", "apps/worker/dist/main.js"]
