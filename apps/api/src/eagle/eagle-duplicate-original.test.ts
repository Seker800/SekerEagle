import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { verifyDuplicateOriginal, withDuplicateOriginalSlot } from './eagle-duplicate-original';
const verify = (bytes: Buffer, options = {}) =>
  verifyDuplicateOriginal(
    Readable.from([bytes]),
    createHash('sha256').update(bytes).digest('hex'),
    options,
  );
test('full-resolution pixel proof ignores metadata but rejects even one changed pixel', async () => {
  const image = sharp({ create: { width: 50, height: 40, channels: 3, background: '#123456' } });
  const a = await image.clone().png().toBuffer();
  const b = await image.clone().withMetadata({ density: 144 }).png().toBuffer();
  assert.notEqual(
    createHash('sha256').update(a).digest('hex'),
    createHash('sha256').update(b).digest('hex'),
  );
  const pa = await verify(a),
    pb = await verify(b);
  assert.equal(pa.status, 'VERIFIED');
  assert.equal(pa.hash, pb.hash);
  const c = await image
    .clone()
    .composite([
      {
        input: Buffer.from([19, 52, 86]),
        raw: { width: 1, height: 1, channels: 3 },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  assert.notEqual(pa.hash, (await verify(c)).hash);
});
test('verification fails closed on source corruption and explicit resource budgets', async () => {
  const a = await sharp({ create: { width: 50, height: 40, channels: 3, background: 'red' } })
    .jpeg()
    .toBuffer();
  await assert.rejects(
    verifyDuplicateOriginal(Readable.from([a]), '0'.repeat(64)),
    /HASH_MISMATCH/,
  );
  await assert.rejects(verify(a, { maxBytes: 8 }), /ORIGINAL_TOO_LARGE/);
  assert.equal((await verify(a, { maxPixels: 10 })).status, 'PIXEL_LIMIT');
});
test('unsupported formats, corrupt decodes and invalid configuration never become proofs', async () => {
  const gif = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
    .gif()
    .toBuffer();
  assert.deepEqual(await verify(gif), { hash: null, status: 'UNSUPPORTED' });
  await assert.rejects(verify(Buffer.from('not an image')));
  await assert.rejects(verify(gif, { maxPixels: 0 }), /INVALID_DUPLICATE_ORIGINAL_BUDGET/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(verify(gif, { signal: controller.signal }), { name: 'AbortError' });
});
test('both modes share a single decoder slot, and a failed job releases it', async () => {
  let active = 0,
    peak = 0;
  const work = async (fail: boolean) =>
    withDuplicateOriginalSlot(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      if (fail) throw new Error('synthetic failure');
      return 'ok';
    });
  const results = await Promise.allSettled([work(true), work(false), work(false)]);
  assert.equal(peak, 1);
  assert.equal(results[0]!.status, 'rejected');
  assert.equal(results[2]!.status, 'fulfilled');
});
