import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNativeBoundary } from './native-boundary.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const files = new Map();
function read(dir) {
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) read(path);
    else if (path.endsWith('.kt')) files.set(path, readFileSync(resolve(root, path), 'utf8'));
  }
}
read('app/src/main/kotlin');
files.set(
  'app/src/main/AndroidManifest.xml',
  readFileSync(resolve(root, 'app/src/main/AndroidManifest.xml'), 'utf8'),
);
test('native launcher and scoped shared repository satisfy the boundary', () =>
  assertNativeBoundary(files));
for (const [name, mutate] of [
  ['WebView import', (f) => f.set('app/src/main/kotlin/Bad.kt', 'import android.webkit.WebView')],
  ['WebView creation', (f) => f.set('app/src/main/kotlin/Bad.kt', 'val view = WebView(context)')],
  [
    'mode-specific clone',
    (f) => f.set('app/src/main/kotlin/Bad.kt', 'class NativePhotoRepository'),
  ],
  [
    'legacy launcher',
    (f) =>
      f.set(
        'app/src/main/AndroidManifest.xml',
        files
          .get('app/src/main/AndroidManifest.xml')
          .replace('".NativeActivity"', '".MainActivity"'),
      ),
  ],
  [
    'exported legacy preview',
    (f) =>
      f.set(
        'app/src/main/AndroidManifest.xml',
        files
          .get('app/src/main/AndroidManifest.xml')
          .replace('android:exported="false"', 'android:exported="true"'),
      ),
  ],
  [
    'unscoped media',
    (f) =>
      f.set(
        'app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt',
        'NativeGalleryPolicy.listPath(mode.name',
      ),
  ],
])
  test(`gate rejects ${name}`, () => {
    const copy = new Map(files);
    mutate(copy);
    assert.throws(() => assertNativeBoundary(copy));
  });
