import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { encodeArtifacts, receiveArtifacts } from './compute-artifacts';

test('artifact frames survive arbitrary transport boundaries and preserve binary bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifact-test-'));
  try {
    const source = encodeArtifacts({ sha256: 'a'.repeat(64) }, [
      { name: '0/0_0.webp', size: 3, source: () => Readable.from([Buffer.from([0, 255, 7])]) },
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of source) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    let seen = false;
    const result = await receiveArtifacts(
      Readable.from([...bytes].map((x) => Buffer.from([x]))),
      directory,
      (manifest) => {
        assert.deepEqual(manifest, { sha256: 'a'.repeat(64) });
        seen = true;
      },
      (name, size) => {
        assert.ok(seen);
        assert.equal(name, '0/0_0.webp');
        assert.equal(size, 3);
      },
    );
    assert.deepEqual(await readFile(join(directory, '0/0_0.webp')), Buffer.from([0, 255, 7]));
    assert.equal(result.files.length, 1);
    assert.equal(result.bytes, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('artifact receiver rejects paths, duplicate files, truncation, trailing bytes and size limits', async () => {
  for (const mode of ['path', 'duplicate', 'truncated', 'trailing', 'oversize', 'manifest']) {
    const directory = await mkdtemp(join(tmpdir(), 'artifact-test-'));
    try {
      const entries = [
        {
          name: mode === 'path' ? '../escape' : 'preview.mp4',
          size: 1,
          source: () => Readable.from([Buffer.from('x')]),
        },
      ];
      if (mode === 'duplicate')
        entries.push({ ...entries[0]!, source: () => Readable.from([Buffer.from('x')]) });
      const chunks: Buffer[] = [];
      for await (const c of encodeArtifacts({}, entries)) chunks.push(Buffer.from(c));
      let bytes = Buffer.concat(chunks);
      if (mode === 'truncated') bytes = bytes.subarray(0, bytes.length - 5);
      if (mode === 'trailing') bytes = Buffer.concat([bytes, Buffer.from('x')]);
      await assert.rejects(
        receiveArtifacts(
          Readable.from([bytes]),
          directory,
          () => {
            if (mode === 'manifest') throw new Error('BAD_MANIFEST');
          },
          () => {
            if (mode === 'oversize') throw new Error('FILE_LIMIT');
          },
        ),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('artifact cancellation closes the current source and never opens future files', async () => {
  let opened = 0,
    closed = 0;
  const source = () =>
    (async function* () {
      opened++;
      try {
        yield Buffer.from('first');
        yield Buffer.from('later');
      } finally {
        closed++;
      }
    })();
  for await (const chunk of encodeArtifacts({}, [
    { name: 'one.webp', size: 10, source },
    { name: 'two.webp', size: 10, source },
  ])) {
    if (opened && chunk.length) break;
  }
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});
