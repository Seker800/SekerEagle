FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/eagle-filter-core/package.json packages/eagle-filter-core/package.json
COPY packages/vector-core/package.json packages/vector-core/package.json
RUN npm install --global npm@10.9.4 && npm ci
COPY apps/web apps/web
COPY packages/eagle-filter-core packages/eagle-filter-core
RUN npm run build --workspace @sekereagle/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
