import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleUploadService } from './eagle-upload.service';

const MiB = 1024 * 1024;

function service() {
  return new EagleUploadService({} as never, {} as never, {} as never, {} as never, 'MATERIAL');
}

test('photos up to 16 MiB upload as one part instead of several 5 MiB parts', () => {
  assert.equal(service().partSizeFor(3 * MiB), 5 * MiB);
  assert.equal(service().partSizeFor(12 * MiB), 12 * MiB);
  assert.equal(service().partSizeFor(16 * MiB), 16 * MiB);
  assert.equal(Math.ceil((12 * MiB) / service().partSizeFor(12 * MiB)), 1);
  assert.equal(Math.ceil((3 * MiB) / service().partSizeFor(3 * MiB)), 1);
});

test('never returns a part size below the 5 MiB floor the Android transport enforces', () => {
  for (const size of [1, 1024, 4 * MiB, 5 * MiB, 6 * MiB]) {
    assert.ok(service().partSizeFor(size) >= 5 * MiB);
    assert.equal(Math.ceil(size / service().partSizeFor(size)), 1);
  }
});

test('larger media uses 16 MiB parts under the gateway request limit', () => {
  const twentyMegabytes = 20 * MiB;
  assert.equal(service().partSizeFor(twentyMegabytes), 16 * MiB);
  assert.equal(Math.ceil(twentyMegabytes / service().partSizeFor(twentyMegabytes)), 2);
  const fiveGigabytes = 5_000_000_000;
  assert.equal(service().partSizeFor(fiveGigabytes), 16 * MiB);
  assert.ok(Math.ceil(fiveGigabytes / service().partSizeFor(fiveGigabytes)) <= 10_000);
});

test('the 10,000-part ceiling still raises the part size for future huge files', () => {
  const twoHundredGigabytes = 200 * 1024 ** 3;
  const partSize = service().partSizeFor(twoHundredGigabytes);
  assert.ok(partSize > 16 * MiB);
  assert.ok(Math.ceil(twoHundredGigabytes / partSize) <= 10_000);
});
