import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDeviceTarget, restorePersistentPreview } from './verify-device.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixture = {
  pid: 123,
  origin: 'http://localhost:42319',
  containers: ['sekereagle-photo-workbench-abc-db', 'sekereagle-photo-workbench-abc-storage'],
};
test('device verification accepts only the isolated workbench and exactly one emulator', () => {
  assert.deepEqual(
    assertDeviceTarget(fixture, 'List of devices attached\nemulator-5554\tdevice\n'),
    { origin: fixture.origin, serial: 'emulator-5554', port: '42319' },
  );
  for (const origin of [
    'https://prod.example',
    'http://localhost:8180',
    'http://192.168.31.89:42319',
    'http://localhost:42319/?x',
  ])
    assert.throws(() => assertDeviceTarget({ ...fixture, origin }, 'emulator-5554\tdevice'));
  for (const devices of [
    '',
    'phone-123\tdevice',
    'emulator-5554\tdevice\nphone-123\tdevice',
    'emulator-5554\toffline',
    'emulator-5554\tdevice\nemulator-5556\tdevice',
  ])
    assert.throws(() => assertDeviceTarget(fixture, devices));
  assert.throws(() =>
    assertDeviceTarget({ ...fixture, containers: ['production-db'] }, 'emulator-5554\tdevice'),
  );
});

test('persistent human test library cannot be used as destructive device-test storage', () => {
  assert.throws(() =>
    assertDeviceTarget(
      {
        ...fixture,
        origin: 'http://localhost:49813',
        containers: ['sekereagle-android-lab-db', 'sekereagle-android-lab-storage'],
      },
      'emulator-5554\tdevice',
    ),
  );
});
test('device runs restore the persistent preview without putting credentials in arguments', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'eagle-preview-'));
  const calls = [];
  const invoke = (...args) => {
    calls.push(args);
    return { status: 0 };
  };
  try {
    assert.equal(await restorePersistentPreview(workspace, invoke), null);
    assert.equal(calls.length, 0);
    await mkdir(join(workspace, '.local/android-lab'), { recursive: true });
    await writeFile(join(workspace, '.local/android-lab/config.json'), '{}');
    assert.equal((await restorePersistentPreview(workspace, invoke)).status, 0);
    assert.deepEqual(calls[0].slice(0, 2), [
      'python3',
      [join(workspace, 'scripts/testing/android-lab-preview.py')],
    ]);
    assert.equal(calls[0][2].cwd, workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
