import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraVideoEncodingArguments, cameraVideoAudioArguments } from './index';
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

test('only an independently counted empty invalid audio track may be omitted', () => {
  const empty = { codec_type: 'audio', codec_tag: '0x0000', sample_rate: '0', channels: 0 };
  assert.deepEqual(cameraVideoAudioArguments({ streams: [empty] }, 0), ['-an']);
  for (const probe of [
    { streams: [{ ...empty, codec_name: 'aac' }] },
    { streams: [{ ...empty, channels: 2 }] },
    { streams: [{ ...empty, sample_rate: '48000' }] },
    { streams: [{ ...empty, codec_tag: '0x1234' }] },
    { streams: [empty, { ...empty, codec_name: 'aac' }] },
    { streams: [] },
  ])
    assert.deepEqual(cameraVideoAudioArguments(probe, 0), ['-map', '0:a:0?']);
  for (const count of [undefined, 1, -1, NaN])
    assert.deepEqual(cameraVideoAudioArguments({ streams: [empty] }, count), ['-map', '0:a:0?']);
});
