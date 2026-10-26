#!/bin/sh
# Run inside the dedicated WSL/Linux checkout, never inside the NAS data directories.
set -eu
repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$repo_root"
: "${EAGLE_COMPUTE_NODE_TOKEN_FILE:?Set the owner-only node token file}"
: "${EAGLE_COMPUTE_NODE_BIND:?Set the verified private IPv4 listen address}"
test -r "$EAGLE_COMPUTE_NODE_TOKEN_FILE"
node -e 'if (process.versions.node.split(".")[0] !== "22") process.exit(1)'
command -v "${EXIFTOOL_PATH:-exiftool}" >/dev/null
command -v "${FFMPEG_PATH:-ffmpeg}" >/dev/null
command -v "${FFPROBE_PATH:-ffprobe}" >/dev/null
command -v "${HEIF_CONVERT_PATH:-heif-dec}"
command -v "${HEIF_INFO_PATH:-heif-info}" >/dev/null
: "${CAMERA_RAW_PYTHON:?Configure a dedicated Python environment with packages/media-core/python/requirements.txt}"
"$CAMERA_RAW_PYTHON" -c 'import rawpy, PIL'
npm ci
npm run db:generate
npm run build --workspace @sekereagle/library-core
npm run build --workspace @sekereagle/photo-render-core
npm run build --workspace @sekereagle/library-persistence
npm run build --workspace @sekereagle/media-core
npm run build --workspace @sekereagle/config
npm run build --workspace @sekereagle/eagle-filter-core
npm run build --workspace @sekereagle/vector-core
npm run build --workspace @sekereagle/worker
# Launch only the stateless executor. No DATABASE_URL or S3 credentials are required.
exec node apps/worker/dist/compute-agent.js
