import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { renderPyramidWork, validatePyramidArtifacts } from './pyramid-work';

test('stateless pyramid preserves original dimensions, orientation, hash and all tile levels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pyramid-work-test-'));
  try {
    const input = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#234567' },
    })
      .jpeg()
      .toBuffer();
    const result = await renderPyramidWork(
      Readable.from([input]),
      'image/jpeg',
      'input',
      directory,
    );
    assert.equal(result.sha256, createHash('sha256').update(input).digest('hex'));
    assert.equal(result.descriptor.width, 640);
    assert.equal(result.descriptor.height, 480);
    assert.equal(result.files.length, 12);
    await validatePyramidArtifacts(
      result.descriptor,
      result.files.map((name) => ({ name, path: join(result.tileDirectory, name) })),
    );
    const invalid = result.files
      .slice(1)
      .map((name) => ({ name, path: join(result.tileDirectory, name) }));
    await assert.rejects(validatePyramidArtifacts(result.descriptor, invalid));
    const first = await readFile(join(result.tileDirectory, result.files[0]!));
    assert.equal((await sharp(first).metadata()).format, 'webp');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
