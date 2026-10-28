import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FACE_MODEL_VERSION,cosineSimilarity,validateFaceResult} from './face-inference';
test('stateless face computation preserves the model contract without loading database runtime',()=>{
  assert.equal(FACE_MODEL_VERSION,'yunet-2023mar-sface-2021dec-v1');
  assert.deepEqual(validateFaceResult({version:FACE_MODEL_VERSION,faces:[]}),[]);
  assert.equal(cosineSimilarity([1,0],[0,1]),0);
  assert.equal(Object.keys(require.cache).some((path)=>path.includes('/@prisma/')),false);
  assert.equal(Object.keys(require.cache).some((path)=>path.includes('/library-persistence/')),false);
});

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferPhotoFaces } from './face-inference';
import { PermanentMediaValidationError } from './media-validation-error';

test('face subprocess distinguishes malformed input from infrastructure failure and uses bounded full-resolution decoding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'face-input-test-'));
  const saved = { ...process.env };
  try {
    process.env.PHOTO_FACE_PYTHON = process.execPath;
    process.env.PHOTO_FACE_MODEL_DIR = directory;
    const script = join(directory, 'infer.cjs');
    process.env.PHOTO_FACE_SCRIPT = script;
    for (const [marker, code] of [['PHOTO_FACE_INPUT_INVALID', 'IMAGE_DECODE_FAILED'], ['PHOTO_FACE_INPUT_TOO_LARGE', 'IMAGE_PIXEL_LIMIT_EXCEEDED']]) {
      await writeFile(script, 'process.stderr.write(' + JSON.stringify(marker + '\n') + ');process.exit(2);');
      await assert.rejects(inferPhotoFaces(Buffer.from('invalid')), (error: unknown) => error instanceof PermanentMediaValidationError && error.code === code);
    }
    await writeFile(script, 'process.stderr.write("PHOTO_FACE_MODEL_CHECKSUM_MISMATCH\n");process.exit(1);');
    await assert.rejects(inferPhotoFaces(Buffer.from('valid')), (error: unknown) => error instanceof Error && !(error instanceof PermanentMediaValidationError));
    await writeFile(script, 'if(process.env.OPENCV_IO_MAX_IMAGE_PIXELS !== "40000000")process.exit(1);console.log(JSON.stringify({version:"yunet-2023mar-sface-2021dec-v1",faces:[]}));');
    assert.deepEqual(await inferPhotoFaces(Buffer.from('valid')), []);
    await assert.rejects(inferPhotoFaces(Buffer.alloc(20 * 1024 * 1024 + 1)), PermanentMediaValidationError);
  } finally {
    process.env = saved;
    await rm(directory, { recursive: true, force: true });
  }
});
