import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectionFailure } from './media-inspection-error';

test('pixel limits have a specific safe error, resource and stream errors remain retryable', () => {
  const pixel = inspectionFailure(new Error('Input image exceeds pixel limit'), 'image');
  assert.equal(pixel.getStatus(), 400);
  assert.match(pixel.message, /1.2 亿/);
  for (const error of [
    Object.assign(new Error('/private/source'), { code: 'ENOMEM' }),
    Object.assign(new Error('secret'), { signal: 'SIGKILL' }),
    Object.assign(new Error('private'), { code: 'ECONNRESET' }),
  ]) {
    const transient = inspectionFailure(error, 'image');
    assert.equal(transient.getStatus(), 503);
    assert.doesNotMatch(transient.message, /private|secret/);
  }
  assert.equal(inspectionFailure(new Error('corrupt header'), 'image').getStatus(), 400);
});
