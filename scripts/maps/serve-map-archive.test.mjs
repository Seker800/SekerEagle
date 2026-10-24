import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveMapArchive } from './serve-map-archive.mjs';

test('archive hosting supports bounded ranges and HEAD, rejects other files and writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-map-'));
  await writeFile(join(directory, 'basemap.pmtiles'), '0123456789');
  const server = createServer(async (req, res) => {
    if (!(await serveMapArchive(req, res, directory))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/maps/basemap.pmtiles`;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal(await head.text(), '');
    const range = await fetch(url, { headers: { Range: 'bytes=2-5' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await range.text(), '2345');
    for (const value of ['bytes=10-', 'bytes=8-2', 'bytes=0-1,4-5', 'bytes=-1', 'nonsense']) {
      assert.equal((await fetch(url, { headers: { Range: value } })).status, 416);
    }
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(url.replace('basemap.pmtiles', 'private.env'))).status, 404);
    await rm(join(directory, 'basemap.pmtiles'));
    assert.equal((await fetch(url)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
