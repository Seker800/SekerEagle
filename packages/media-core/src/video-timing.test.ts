import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeCameraVideo, transcodeCameraVideo, type CameraVideoEncoder } from './index';

test('transcoding preserves the display duration of a held final video frame', { skip: !process.env.FFMPEG_PATH || !process.env.FFPROBE_PATH }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-tail-'));
  try {
    const source = join(directory, 'source.mp4');
    await promisify(execFile)(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=64x64:rate=30:duration=1',
      '-an',
      '-c:v',
      'libx264',
      '-bf',
      '0',
      '-bsf:v',
      'setts=duration=if(eq(N\\,29)\\,40\\,1)',
      source,
    ]);
    const original = await probeCameraVideo(source, 'video/mp4');
    assert.equal(original.durationMs, 2300);
    const encoder = (process.env.EAGLE_TEST_VIDEO_ENCODER || 'libx264') as CameraVideoEncoder;
    const result = await transcodeCameraVideo(
      source,
      join(directory, 'output.mp4'),
      original.durationMs,
      encoder,
    );
    assert.ok(Math.abs(result.durationMs - original.durationMs) <= 34);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
