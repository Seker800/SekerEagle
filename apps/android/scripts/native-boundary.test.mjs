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
  [
    'viewmodel-owned upload',
    (f) =>
      f.set(
        'app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt',
        'NativeUploads(context)',
      ),
  ],
  [
    'modal upload progress',
    (f) =>
      f.set(
        'app/src/main/kotlin/com/sekereagle/android/NativeGalleryScreen.kt',
        'NativeUploadDialog(state, uploads)',
      ),
  ],
  [
    'exported upload service',
    (f) =>
      f.set(
        'app/src/main/AndroidManifest.xml',
        files
          .get('app/src/main/AndroidManifest.xml')
          .replace(
            'name=".NativeUploadService" android:exported="false"',
            'name=".NativeUploadService" android:exported="true"',
          ),
      ),
  ],
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

test('manual uploads use a service-owned queue and a shared nonmodal transfer screen', () => {
  const model = files.get('app/src/main/kotlin/com/sekereagle/android/NativeGalleryViewModel.kt');
  const screen = files.get('app/src/main/kotlin/com/sekereagle/android/NativeGalleryScreen.kt');
  assert.ok(
    model.includes('NativeTransferManager.get('),
    'The gallery must observe a service-owned transfer queue',
  );
  assert.ok(!/\bNativeUploads\s*\(/.test(model), 'The gallery must not own the upload worker');
  assert.ok(
    !screen.includes('NativeUploadDialog('),
    'Upload progress must not block gallery browsing',
  );
  assert.ok(manualService(files.get('app/src/main/AndroidManifest.xml')));
});
function manualService(manifest) {
  return /<service\b[^>]*android:name="\.NativeUploadService"[^>]*android:exported="false"[^>]*android:foregroundServiceType="dataSync"/.test(
    manifest,
  );
}

for (const [name, before, after] of [
  ['unscoped editor origin', 'uri.host != repo.editorHost', 'false'],
  ['editor file access', 'settings.allowFileAccess = false', 'settings.allowFileAccess = true'],
  [
    'editor remote page',
    'loadUrl("$editorOrigin/native-editor.html?lang=zh-CN")',
    'loadUrl(session.origin)',
  ],
])
  test(`gate rejects ${name}`, () => {
    const copy = new Map(files);
    const path = 'app/src/main/kotlin/com/sekereagle/android/NativeEditor.kt';
    assert.ok(copy.get(path).includes(before));
    copy.set(path, copy.get(path).replace(before, after));
    assert.throws(() => assertNativeBoundary(copy));
  });
