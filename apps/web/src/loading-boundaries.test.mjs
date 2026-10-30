import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'vite';

test('production login and gallery exclude optional map, EXIF and batch-render pipelines', async () => {
  const result = await build({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  });
  const chunks = result.output.filter((item) => item.type === 'chunk');
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  function staticModules(chunk, seen = new Set()) {
    if (seen.has(chunk.fileName)) return [];
    seen.add(chunk.fileName);
    return [
      ...Object.keys(chunk.modules),
      ...chunk.imports.flatMap((name) =>
        byName.has(name) ? staticModules(byName.get(name), seen) : [],
      ),
    ];
  }
  const entry = chunks.find((chunk) => chunk.isEntry);
  assert.ok(entry);
  const login = staticModules(entry).join('\n');
  assert.doesNotMatch(
    login,
    /SekerEaglePage\.tsx|PhotoMap\.tsx|EagleBatchPhotoEdit\.tsx|node_modules\/(?:leaflet|exifr|fast-png)\//u,
  );
  const gallery = chunks.find((chunk) =>
    Object.keys(chunk.modules).some((id) => id.endsWith('/SekerEaglePage.tsx')),
  );
  assert.ok(gallery);
  assert.doesNotMatch(
    staticModules(gallery).join('\n'),
    /PhotoMap\.tsx|EagleBatchPhotoEdit\.tsx|node_modules\/(?:leaflet|exifr|fast-png)\//u,
  );
});
