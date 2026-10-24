import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Public geographic data only; a fixed filename cannot address private files or upstream URLs. */
export async function serveMapArchive(req, res, directory) {
  if (req.url?.split('?')[0] !== '/maps/basemap.pmtiles') return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return true;
  }
  const path = join(directory, 'basemap.pmtiles');
  const file = await stat(path).catch(() => null);
  if (!file?.isFile()) {
    res.writeHead(404);
    res.end();
    return true;
  }
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    ETag: `"${file.size}-${Math.trunc(file.mtimeMs)}"`,
  };
  let start = 0,
    end = file.size - 1,
    status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    start = match ? Number(match[1]) : NaN;
    end = match?.[2] ? Math.min(Number(match[2]), end) : end;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= file.size
    ) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.size}` });
      res.end();
      return true;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
  }
  res.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD') res.end();
  else {
    const stream = createReadStream(path, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
  return true;
}
