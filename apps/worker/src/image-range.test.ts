import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { readOwnedImageRange } from './image-range';
const source = {
  bucket: 'sekereagle-test',
  ownerId: 'owner',
  key: 'users/owner/assets/a/original.jpg',
  byteSize: 100,
};
function response(bytes = 10, range = 'bytes 20-29/100', declared = 10) {
  return {
    Body: Readable.from([Buffer.alloc(bytes)]) as never,
    ContentLength: declared,
    ContentRange: range,
    $metadata: {},
  };
}
test('owned image ranges request exact bounded bytes and close the response', async () => {
  const object = response();
  const bytes = await readOwnedImageRange(
    async (input) => {
      assert.equal(input.Range, 'bytes=20-29');
      assert.equal(input.Key, source.key);
      return object;
    },
    source,
    20,
    10,
  );
  assert.equal(bytes.length, 10);
  assert.equal((object.Body as unknown as Readable).destroyed, true);
});
test('cross-owner and out-of-bounds ranges fail before object access', async () => {
  let calls = 0;
  const send = async () => {
    calls++;
    return response();
  };
  for (const changed of [
    { ...source, ownerId: 'other' },
    { ...source, byteSize: 25 },
  ])
    await assert.rejects(() => readOwnedImageRange(send, changed, 20, 10), /SCOPE/);
  for (const [start, length] of [
    [-1, 10],
    [0, 0],
    [0, Infinity],
    [99, 2],
    [0, 65 * 1024 * 1024],
  ])
    await assert.rejects(() => readOwnedImageRange(send, source, start!, length!), /SCOPE/);
  assert.equal(calls, 0);
});
test('ignored, truncated and oversized ranges fail closed and release the body', async () => {
  for (const object of [
    response(10, '', 100),
    response(10, 'bytes 0-9/100'),
    response(9),
    response(11),
    { ...response(), Body: undefined },
  ]) {
    await assert.rejects(
      () => readOwnedImageRange(async () => object, source, 20, 10),
      /IMAGE_RANGE/,
    );
    if (object.Body) assert.equal((object.Body as unknown as Readable).destroyed, true);
  }
});
