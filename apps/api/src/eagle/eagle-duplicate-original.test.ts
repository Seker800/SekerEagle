import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { verifyDuplicateOriginal } from './eagle-duplicate-original';
const verify = (bytes: Buffer, options = {}) => verifyDuplicateOriginal(
  Readable.from([bytes]), createHash('sha256').update(bytes).digest('hex'), options,
);
test('full-resolution pixel proof ignores metadata but rejects even one changed pixel', async () => {
  const image = sharp({ create: { width: 50, height: 40, channels: 3, background: '#123456' } });
  const a = await image.clone().png().toBuffer();
  const b = await image.clone().withMetadata({ density: 144 }).png().toBuffer();
  assert.notEqual(createHash('sha256').update(a).digest('hex'), createHash('sha256').update(b).digest('hex'));
  const pa = await verify(a), pb = await verify(b);
  assert.equal(pa.status, 'VERIFIED');
  assert.equal(pa.hash, pb.hash);
  const c = await image.clone().composite([{ input: Buffer.from([19,52,86]), raw: { width: 1, height: 1, channels: 3 }, left: 0, top: 0 }]).png().toBuffer();
  assert.notEqual(pa.hash, (await verify(c)).hash);
});
test('verification fails closed on source corruption and explicit resource budgets', async () => {
  const a = await sharp({ create: { width: 50, height: 40, channels: 3, background: 'red' } }).jpeg().toBuffer();
  await assert.rejects(verifyDuplicateOriginal(Readable.from([a]), '0'.repeat(64)), /HASH_MISMATCH/);
  await assert.rejects(verify(a, { maxBytes: 8 }), /ORIGINAL_TOO_LARGE/);
  assert.equal((await verify(a, { maxPixels: 10 })).status, 'PIXEL_LIMIT');
});
