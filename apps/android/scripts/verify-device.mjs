import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { androidSdk } from './runtime.mjs';
const root = fileURLToPath(new URL('../../..', import.meta.url));
export function assertDeviceTarget(manifest, devices) {
  const origin = new URL(manifest.origin);
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== 'localhost' ||
    !origin.port ||
    ['8180', '3000'].includes(origin.port) ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    manifest.origin !== origin.origin
  )
    throw new Error('Device verification requires the isolated loopback photo workbench.');
  if (
    !Number.isSafeInteger(manifest.pid) ||
    manifest.pid <= 0 ||
    !Array.isArray(manifest.containers) ||
    manifest.containers.length !== 2 ||
    !manifest.containers.every((name) =>
      /^sekereagle-photo-workbench-[a-f0-9-]+-(?:db|storage)$/.test(name),
    )
  )
    throw new Error('Invalid isolated workbench manifest.');
  const connected = devices
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices') && !line.startsWith('*'));
  if (connected.length !== 1 || !/^emulator-\d+\s+device\b/.test(connected[0]))
    throw new Error(
      'Connect exactly one emulator and disconnect physical phones before running device tests.',
    );
  return { origin: manifest.origin, serial: connected[0].split(/\s+/)[0], port: origin.port };
}
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0)
    throw new Error(`${command.split('/').at(-1)} failed during isolated device verification`);
  return result.stdout;
}
async function main() {
  const manifest = JSON.parse(
    await readFile(join(root, '.omx/artifacts/photo-workbench.json'), 'utf8'),
  );
  const adb = join(
    androidSdk(),
    'platform-tools',
    process.platform === 'win32' ? 'adb.exe' : 'adb',
  );
  const target = assertDeviceTarget(manifest, run(adb, ['devices', '-l']));
  process.kill(manifest.pid, 0);
  for (const container of manifest.containers)
    if (run('docker', ['inspect', '--format', '{{.State.Running}}', container]).trim() !== 'true')
      throw new Error('The isolated workbench containers must be running.');
  run(adb, ['-s', target.serial, 'reverse', `tcp:${target.port}`, `tcp:${target.port}`]);
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'apps/android/scripts/gradle.mjs'),
      'connectedDebugAndroidTest',
      `-Pandroid.testInstrumentationRunnerArguments.origin=${target.origin}`,
      '-Pandroid.testInstrumentationRunnerArguments.screenshots=true',
    ],
    { cwd: root, env: { ...process.env, ANDROID_SERIAL: target.serial }, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
