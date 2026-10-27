import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVideoWork, validateVideoManifest } from './video-work';
test('video recipes cannot carry URLs, commands, paths or unsupported containers', () => {
  assert.deepEqual(validateVideoWork({ mimeType: 'video/mp4', stage: 'PLAYBACK' }), {
    mimeType: 'video/mp4',
    stage: 'PLAYBACK',
  });
  for (const value of [
    null,
    { mimeType: 'text/plain', stage: 'PLAYBACK' },
    { mimeType: 'video/mp4', stage: 'sh' },
    { mimeType: 'video/mp4', stage: 'PLAYBACK', url: 'file:///private' },
  ])
    assert.throws(() => validateVideoWork(value));
});
test('video manifest validates source hash, stage, bounded dimensions and playback duration', () => {
  const work = { mimeType: 'video/mp4', stage: 'PLAYBACK' } as const;
  const value = {
    sha256: 'a'.repeat(64),
    work,
    metadata: { width: 3840, height: 2160, durationMs: 1000 },
    playbackMetadata: { width: 1920, height: 1080, durationMs: 1000 },
  };
  assert.equal(validateVideoManifest(value, work).metadata.width, 3840);
  assert.throws(() => validateVideoManifest({ ...value, sha256: 'bad' }, work));
  assert.throws(() =>
    validateVideoManifest(
      { ...value, playbackMetadata: { ...value.playbackMetadata, durationMs: 99999 } },
      work,
    ),
  );
  assert.throws(() =>
    validateVideoManifest({ ...value, metadata: { ...value.metadata, width: -1 } }, work),
  );
  assert.throws(() => validateVideoManifest(value, { ...work, stage: 'POSTER' }));
});
