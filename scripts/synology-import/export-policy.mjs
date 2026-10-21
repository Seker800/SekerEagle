import { writeFileSync } from 'node:fs';
import {
  CAMERA_MEDIA_FORMATS,
  CAMERA_MAX_IMAGE_BYTES,
  CAMERA_MAX_VIDEO_BYTES,
} from '../../packages/library-core/dist/index.js';
const policy = {
  formats: CAMERA_MEDIA_FORMATS,
  imageMaxBytes: CAMERA_MAX_IMAGE_BYTES,
  videoMaxBytes: CAMERA_MAX_VIDEO_BYTES,
};
if (!process.argv[2]) throw new Error('Supply a private output file');
writeFileSync(process.argv[2], JSON.stringify(policy), { mode: 0o600 });
