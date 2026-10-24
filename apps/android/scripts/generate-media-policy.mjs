import {
  CAMERA_MEDIA_FORMATS,
  CAMERA_MAX_IMAGE_BYTES,
  CAMERA_MAX_VIDEO_BYTES,
} from '../../../packages/library-core/dist/index.js';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
const directory = new URL('../app/build/generated/media-assets/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL('media-policy.json', directory),
  JSON.stringify({
    formats: CAMERA_MEDIA_FORMATS,
    maxImageBytes: CAMERA_MAX_IMAGE_BYTES,
    maxVideoBytes: CAMERA_MAX_VIDEO_BYTES,
  }),
);

await copyFile(
  new URL('../../web/src/components/photos/basemap/cities.json', import.meta.url),
  new URL('cities.json', directory),
);
