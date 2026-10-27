import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraVideoEncodingArguments } from './index';
test('video encoders remain explicit, H264 and bounded; CPU default is preserved', () => {
  assert.deepEqual(cameraVideoEncodingArguments(), [
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '22',
  ]);
  assert.ok(cameraVideoEncodingArguments('h264_videotoolbox').includes('h264_videotoolbox'));
  assert.ok(cameraVideoEncodingArguments('h264_nvenc').includes('h264_nvenc'));
  assert.throws(() => cameraVideoEncodingArguments('arbitrary' as never));
});
