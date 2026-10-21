import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDeviceTarget } from './verify-device.mjs';
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
