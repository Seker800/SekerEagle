import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

// Ephemeral login fixture belongs only to androidTest assets, never the application APK.
const nativeFixture = resolve(root, '.omx/artifacts/native-test-credentials.json');
const targetFixture = resolve(output, 'native-test-credentials.json');
rmSync(targetFixture, { force: true });
if (existsSync(nativeFixture)) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, '.omx/artifacts/photo-workbench.json'), 'utf8'),
  );
  const fixture = JSON.parse(readFileSync(nativeFixture, 'utf8'));
  if (fixture.origin !== manifest.origin || !/^http:\/\/localhost:[0-9]+$/.test(fixture.origin))
    throw new Error('Native test fixture requires the isolated loopback workbench.');
  process.kill(manifest.pid, 0);
  writeFileSync(targetFixture, JSON.stringify(fixture), { mode: 0o600 });
}
