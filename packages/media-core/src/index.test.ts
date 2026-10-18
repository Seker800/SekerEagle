import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCameraVideoProbe } from './index';

const probe = (container: string, codec: string) => ({
  format: { format_name: container, duration: '2' },
  streams: [{ codec_type: 'video', codec_name: codec, width: 1920, height: 1080 }],
});
test('accepts common camera containers and codecs for transcoded playback', () => {
  for (const [mime, container, codec] of [
    ['video/mp4', 'mov,mp4', 'hevc'],
    ['video/quicktime', 'mov,mp4', 'prores'],
    ['video/mp2t', 'mpegts', 'h264'],
    ['application/mxf', 'mxf', 'mpeg2video'],
    ['video/x-msvideo', 'avi', 'mjpeg'],
  ])
    assert.deepEqual(parseCameraVideoProbe(probe(container!, codec!), mime!), {
      width: 1920,
      height: 1080,
      durationMs: 2000,
    });
});
test('rejects disguised containers, unsupported codecs, attached pictures and unsafe dimensions', () => {
  assert.throws(() => parseCameraVideoProbe(probe('avi', 'h264'), 'video/mp4'));
  assert.throws(() => parseCameraVideoProbe(probe('mov,mp4', 'unknown'), 'video/mp4'));
  assert.throws(() =>
    parseCameraVideoProbe(
      {
        ...probe('mov,mp4', 'h264'),
        streams: [{ codec_type: 'video', codec_name: 'h264', width: 0, height: 1080 }],
      },
      'video/mp4',
    ),
  );
  assert.throws(() =>
    parseCameraVideoProbe(
      {
        ...probe('mov,mp4', 'h264'),
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 100,
            height: 100,
            disposition: { attached_pic: 1 },
          },
        ],
      },
      'video/mp4',
    ),
  );
});

test('camera video orientation and duration remain bounded', () => {
  const rotated = {
    ...probe('mov,mp4', 'h264'),
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        side_data_list: [{ rotation: -90 }],
      },
    ],
  };
  assert.deepEqual(parseCameraVideoProbe(rotated, 'video/mp4'), {
    width: 1080,
    height: 1920,
    durationMs: 2000,
  });
  assert.throws(() =>
    parseCameraVideoProbe(
      { ...rotated, format: { format_name: 'mov,mp4', duration: 'NaN' } },
      'video/mp4',
    ),
  );
});
