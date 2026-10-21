FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /sekereagle
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/library-core/package.json packages/library-core/package.json
COPY packages/media-core/package.json packages/media-core/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/eagle-filter-core/package.json packages/eagle-filter-core/package.json
COPY packages/vector-core/package.json packages/vector-core/package.json
RUN npm install --global npm@10.9.4 && npm ci
COPY apps/api/prisma apps/api/prisma
COPY apps/worker apps/worker
COPY packages/library-core packages/library-core
COPY packages/media-core packages/media-core
COPY packages/config packages/config
COPY packages/vector-core packages/vector-core
RUN npm run db:generate && npm run build --workspace @sekereagle/library-core && npm run build --workspace @sekereagle/media-core && npm run build --workspace @sekereagle/config && npm run build --workspace @sekereagle/vector-core && npm run build --workspace @sekereagle/worker

FROM node:22-bookworm-slim AS runtime
RUN printf '%s\n' 'deb https://deb.debian.org/debian bookworm-backports main' > /etc/apt/sources.list.d/sekereagle-media.list
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv libimage-exiftool-perl openssl && apt-get install -y --no-install-recommends -t bookworm-backports libheif-examples libheif-plugin-libde265 && rm -rf /var/lib/apt/lists/*
COPY packages/media-core/python/requirements.txt /tmp/camera-media-requirements.txt
RUN python3 -m venv /opt/camera-media && /opt/camera-media/bin/pip install --no-cache-dir -r /tmp/camera-media-requirements.txt
ENV CAMERA_RAW_PYTHON=/opt/camera-media/bin/python
ARG WITH_PHOTO_FACE=0
COPY services/photo-face/requirements.txt /tmp/photo-face-requirements.txt
RUN if [ "$WITH_PHOTO_FACE" = "1" ]; then apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && python3 -m venv /opt/photo-face && /opt/photo-face/bin/pip install --no-cache-dir -r /tmp/photo-face-requirements.txt && rm -rf /var/lib/apt/lists/*; fi
ENV NODE_ENV=production
WORKDIR /sekereagle
COPY --from=build /sekereagle/node_modules ./node_modules
COPY --from=build /sekereagle/apps/worker/dist ./apps/worker/dist
COPY --from=build /sekereagle/packages/config ./packages/config
COPY --from=build /sekereagle/packages/library-core ./packages/library-core
COPY --from=build /sekereagle/packages/media-core ./packages/media-core
COPY --from=build /sekereagle/packages/vector-core ./packages/vector-core
COPY package.json package-lock.json ./
COPY services/photo-face services/photo-face
USER node
CMD ["node", "apps/worker/dist/main.js"]
