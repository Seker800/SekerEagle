import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACE_MODEL_VERSION, cosineSimilarity, validateFaceResult } from './face-inference';
test('stateless face computation preserves the model contract without loading database runtime', () => {
  assert.equal(FACE_MODEL_VERSION, 'yunet-2023mar-sface-2021dec-v1');
  assert.deepEqual(validateFaceResult({ version: FACE_MODEL_VERSION, faces: [] }), []);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(
    Object.keys(require.cache).some((path) => path.includes('/@prisma/')),
    false,
  );
  assert.equal(
    Object.keys(require.cache).some((path) => path.includes('/library-persistence/')),
    false,
  );
});

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferPhotoFaces, stopFaceInference } from './face-inference';
import { PermanentMediaValidationError } from './media-validation-error';

const SERVER_SCRIPT = `
const fs = require('node:fs');
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const request = JSON.parse(line);
    const content = fs.readFileSync(request.path, 'utf8').trim();
    if (content === 'invalid') {
      console.log(JSON.stringify({ id: request.id, error: 'PHOTO_FACE_INPUT_INVALID' }));
      continue;
    }
    if (content === 'too-large') {
      console.log(JSON.stringify({ id: request.id, error: 'PHOTO_FACE_INPUT_TOO_LARGE' }));
      continue;
    }
    if (content === 'model-mismatch') {
      process.stderr.write('PHOTO_FACE_MODEL_CHECKSUM_MISMATCH\\n');
      process.exit(1);
    }
    if (process.env.OPENCV_IO_MAX_IMAGE_PIXELS !== '40000000') process.exit(1);
    console.log(JSON.stringify({ id: request.id, version: 'yunet-2023mar-sface-2021dec-v1', faces: [] }));
  }
});
`;

test('face inference keeps one bounded process and separates input from infrastructure failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'face-input-test-'));
  const saved = { ...process.env };
  try {
    process.env.PHOTO_FACE_PYTHON = process.execPath;
    process.env.PHOTO_FACE_MODEL_DIR = directory;
    const script = join(directory, 'infer.cjs');
    process.env.PHOTO_FACE_SCRIPT = script;
    await writeFile(script, SERVER_SCRIPT);
    await assert.rejects(
      inferPhotoFaces(Buffer.from('invalid')),
      (error: unknown) =>
        error instanceof PermanentMediaValidationError && error.code === 'IMAGE_DECODE_FAILED',
    );
    await assert.rejects(
      inferPhotoFaces(Buffer.from('too-large')),
      (error: unknown) =>
        error instanceof PermanentMediaValidationError &&
        error.code === 'IMAGE_PIXEL_LIMIT_EXCEEDED',
    );
    await assert.rejects(
      inferPhotoFaces(Buffer.from('model-mismatch')),
      (error: unknown) =>
        error instanceof Error && !(error instanceof PermanentMediaValidationError),
    );
    assert.deepEqual(await inferPhotoFaces(Buffer.from('valid')), []);
    await assert.rejects(
      inferPhotoFaces(Buffer.alloc(20 * 1024 * 1024 + 1)),
      PermanentMediaValidationError,
    );
  } finally {
    stopFaceInference();
    process.env = saved;
    await rm(directory, { recursive: true, force: true });
  }
});
