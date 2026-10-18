import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkLibrarySharing, readLibrarySources } from './library-sharing.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = readLibrarySources(root);
const page = 'apps/web/src/components/eagle/SekerEaglePage.tsx';
const photoModule = 'apps/api/src/photos/photo-library.module.ts';
function rejectsMutation(file, mutate, rule) {
  const sources = new Map(baseline);
  const before = sources.get(file);
  const after = mutate(before);
  assert.notEqual(after, before, 'mutation must change the fixture');
  sources.set(file, after);
  assert.ok(checkLibrarySharing(sources).some((error) => error.rule === rule), rule);
}

test('current architecture shares generic paths and permits photography extensions', () => {
  assert.deepEqual(checkLibrarySharing(baseline), []);
});
test('rejects a second thumbnail renderer even when imported with an alias', () => {
  rejectsMutation(page, (s) => s.replace('<EagleAssetThumbnail', '<EagleAssetThumbnail />\n<EagleAssetThumbnail'), 'shared-composition');
});
test('rejects mode-conditional generic rendering', () => {
  rejectsMutation(page, (s) => s.replace('<EagleAssetThumbnail', "{libraryMode === 'PHOTO' && <EagleAssetThumbnail").replace('displayWidth={thumbnailSize}\n                          />', 'displayWidth={thumbnailSize}\n                          />}'), 'shared-composition');
});
test('rejects photo-specific implementations inside shared layout', () => {
  rejectsMutation('apps/web/src/components/eagle/eagle-masonry-layout.ts', (s) => "import { customLayout } from '../photos/custom-layout';\n" + s, 'dependency-direction');
});
test('rejects a mode branch inside the common layout algorithm', () => {
  rejectsMutation('apps/web/src/components/eagle/eagle-masonry-layout.ts', (s) => s + "\nfunction fork(mode: string) { return mode === 'PHOTO' ? 200 : 300; }", 'mode-neutral-core');
});
test('rejects overrides on inherited generic photo routes', () => {
  rejectsMutation(photoModule, (s) => s.replace('PhotosController extends EagleController {}', 'PhotosController extends EagleController { listAssets() { return []; } }'), 'inherited-controllers');
});
test('rejects replacing the shared providers with a photo implementation', () => {
  rejectsMutation(photoModule, (s) => s.replace('    PhotoManagementService,', '    PhotoManagementService,\n    { provide: EagleService, useClass: PhotoAssetService },'), 'shared-providers');
});
test('rejects missing shared composition instead of silently skipping a moved file', () => {
  const sources = new Map(baseline);
  sources.delete(page);
  assert.ok(checkLibrarySharing(sources).some((error) => error.rule === 'required-source'));
});
test('does not mistake comments or ordinary strings for imports or mode branches', () => {
  const sources = new Map(baseline);
  const file = 'apps/web/src/components/eagle/eagle-masonry-layout.ts';
  sources.set(file, baseline.get(file) + "\n// import x from '../photos/fake'; if (mode === 'PHOTO') {}\n");
  assert.deepEqual(checkLibrarySharing(sources), []);
});
