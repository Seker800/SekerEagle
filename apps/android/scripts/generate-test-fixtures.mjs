import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(root, 'apps/android/app/build/generated/device-fixtures');
mkdirSync(output, { recursive: true });
const venv = resolve(root, '.omx/camera-media/venv/bin/python');
const python = process.env.CAMERA_RAW_PYTHON || (existsSync(venv) ? venv : 'python3');
execFileSync(
  python,
  [resolve(root, 'scripts/testing/create-camera-fixtures.py'), resolve(output, 'synthetic.dng')],
  { cwd: root, stdio: 'inherit' },
);
execFileSync(
  process.env.FFMPEG_PATH || 'ffmpeg',
  [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=10',
    '-t',
    '0.5',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    resolve(output, 'synthetic.mp4'),
  ],
  { stdio: 'inherit' },
);
