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
  const errors = checkLibrarySharing(sources);
  if (rule !== 'parse-error')
    assert.ok(
      !errors.some((error) => error.rule === 'parse-error'),
      'mutation must remain valid syntax',
    );
  assert.ok(
    errors.some((error) => error.rule === rule),
    rule,
  );
}

test('current architecture shares generic paths and permits photography extensions', () => {
  assert.deepEqual(checkLibrarySharing(baseline), []);
});
test('rejects a second thumbnail renderer even when imported with an alias', () => {
  rejectsMutation(
    page,
    (s) =>
      s
        .replace(
          'import { EagleAssetThumbnail }',
          'import { EagleAssetThumbnail as ThumbnailAlias }',
        )
        .replaceAll('<EagleAssetThumbnail', '<ThumbnailAlias')
        .replace('<ThumbnailAlias', '<ThumbnailAlias />\n<ThumbnailAlias'),
    'shared-composition',
  );
});
test('rejects mode-conditional generic rendering', () => {
  rejectsMutation(
    page,
    (s) =>
      s.replace(
        /<EagleAssetThumbnail\b[\s\S]*?\/>/,
        (thumbnail) => `{libraryMode === 'PHOTO' && ${thumbnail}}`,
      ),
    'shared-composition',
  );
});
test('rejects photo-specific implementations inside shared layout', () => {
  rejectsMutation(
    'apps/web/src/components/eagle/eagle-masonry-layout.ts',
    (s) => "import { customLayout } from '../photos/custom-layout';\n" + s,
    'dependency-direction',
  );
});
test('rejects a mode branch inside the common layout algorithm', () => {
  rejectsMutation(
    'apps/web/src/components/eagle/eagle-masonry-layout.ts',
    (s) => s + "\nfunction fork(mode: string) { return mode === 'PHOTO' ? 200 : 300; }",
    'mode-neutral-core',
  );
});
test('rejects overrides on inherited generic photo routes', () => {
  rejectsMutation(
    photoModule,
    (s) =>
      s.replace(
        'PhotosController extends EagleController {}',
        'PhotosController extends EagleController { listAssets() { return []; } }',
      ),
    'inherited-controllers',
  );
});
test('rejects a photo-specific task center route override', () => {
  rejectsMutation(
    photoModule,
    (s) =>
      s.replace(
        'PhotoTaskCenterController extends EagleTaskCenterController {}',
        'PhotoTaskCenterController extends EagleTaskCenterController { overview() { return []; } }',
      ),
    'inherited-controllers',
  );
});
test('rejects replacing the shared providers with a photo implementation', () => {
  rejectsMutation(
    photoModule,
    (s) =>
      s.replace(
        '    PhotoManagementService,',
        '    PhotoManagementService,\n    { provide: EagleService, useClass: PhotoAssetService },',
      ),
    'shared-providers',
  );
});
test('rejects missing shared composition instead of silently skipping a moved file', () => {
  const sources = new Map(baseline);
  sources.delete(page);
  assert.ok(checkLibrarySharing(sources).some((error) => error.rule === 'required-source'));
});
test('does not mistake comments or ordinary strings for imports or mode branches', () => {
  const sources = new Map(baseline);
  const file = 'apps/web/src/components/eagle/eagle-masonry-layout.ts';
  sources.set(
    file,
    baseline.get(file) + "\n// import x from '../photos/fake'; if (mode === 'PHOTO') {}\n",
  );
  assert.deepEqual(checkLibrarySharing(sources), []);
});

test('rejects reverse dependencies through re-exports and dynamic imports', () => {
  for (const edge of ["export { x } from '../photos/x';", "const x = import('../photos/x');"]) {
    rejectsMutation(
      'apps/web/src/components/eagle/eagle-masonry-layout.ts',
      (s) => s + '\n' + edge,
      'dependency-direction',
    );
  }
});
test('rejects a forked top-level workspace even if the existing page is retained', () => {
  rejectsMutation(
    'apps/web/src/App.tsx',
    (s) =>
      s
        .replace('<SekerEaglePage', "{libraryMode === 'MATERIAL' && <SekerEaglePage")
        .replace('        />\n      </div>', '        />}\n      </div>'),
    'shared-composition',
  );
});
test('rejects missing core imports, a copied photo controller, and a removed provider registry', () => {
  rejectsMutation(
    page,
    (s) => s.replace("from './eagle-masonry-layout'", "from '../photos/layout'"),
    'shared-composition',
  );
  rejectsMutation(
    photoModule,
    (s) => s.replace('PhotosController extends EagleController {}', 'PhotosController {}'),
    'inherited-controllers',
  );
  rejectsMutation(
    photoModule,
    (s) =>
      s.replace(
        '...EAGLE_LIBRARY_PROVIDERS.filter((provider) => provider !== EagleMaintenanceService),',
        '',
      ),
    'shared-providers',
  );
});
test('rejects malformed source instead of accepting a partial syntax tree', () => {
  rejectsMutation(page, (s) => s + '\nfunction broken( {', 'parse-error');
});

test('rejects photo-only overlays inside the shared card', () => {
  rejectsMutation(
    page,
    (s) =>
      s.replace(
        '{(selectionMode || isBatchSelection) && (',
        "{libraryMode === 'PHOTO' && <time>2024-01-01</time>}\n{(selectionMode || isBatchSelection) && (",
      ),
    'shared-card',
  );
});

test('rejects generic rendering guarded by mode aliases and alias chains', () => {
  for (const declarations of [
    "const photoFlag = libraryMode === 'PHOTO';",
    "const photo = libraryMode; const photoFlag = photo === 'PHOTO';",
    "const first = libraryMode !== 'MATERIAL'; const photoFlag = first;",
  ]) {
    rejectsMutation(
      page,
      (s) =>
        s
          .replace('  return (\n    <main', `  ${declarations}\n  return (\n    <main`)
          .replace(
            /<EagleAssetThumbnail\b[\s\S]*?\/>/,
            (thumbnail) => `{photoFlag && ${thumbnail}}`,
          ),
      'shared-composition',
    );
  }
});
test('rejects common controller subclasses outside the known module', () => {
  const sources = new Map(baseline);
  sources.set(
    'apps/api/src/photos/extra.controller.ts',
    'class ExtraController extends EagleController { listAssets() { return []; } }',
  );
  assert.ok(checkLibrarySharing(sources).some((e) => e.rule === 'inherited-controllers'));
});

test('photo organization remains a photography provider and cannot replace common services', () => {
  rejectsMutation(
    photoModule,
    (s) =>
      s.replace(
        '    PhotoAgentService,',
        '    PhotoAgentService,\n    { provide: EagleService, useClass: PhotoAgentService },',
      ),
    'shared-providers',
  );
});

for (const file of ['apps/web/src/App.tsx', 'packages/library-core/src/index.ts']) {
  test(`rejects backend persistence import from ${file}`, () => {
    rejectsMutation(
      file,
      (s) => "import { syncAssetPrivacy } from '@sekereagle/library-persistence';\n" + s,
      'server-persistence-boundary',
    );
  });
}
test('rejects dynamic Prisma import from browser code', () => {
  rejectsMutation(
    'apps/web/src/App.tsx',
    (s) => "const db = import('@prisma/client');\n" + s,
    'server-persistence-boundary',
  );
});

test('map aggregation is a named photography extension, never an alternative generic asset service', () => {
  rejectsMutation(
    photoModule,
    (s) =>
      s.replace(
        '    PhotoMapService,',
        '    PhotoMapService,\n    { provide: EagleService, useClass: PhotoMapService },',
      ),
    'shared-providers',
  );
  rejectsMutation(
    photoModule,
    (s) => s.replace('    PhotoMapService,', '    ArbitraryMapProvider,'),
    'shared-providers',
  );
});

test('statistics remains a named photography extension and cannot replace common services', () => {
  rejectsMutation(
    photoModule,
    (s) =>
      s.replace(
        '    PhotoStatisticsService,',
        '    PhotoStatisticsService,\n    { provide: EagleService, useClass: PhotoStatisticsService },',
      ),
    'shared-providers',
  );
  rejectsMutation(
    photoModule,
    (s) => s.replace('    PhotoStatisticsService,', '    ArbitraryStatisticsProvider,'),
    'shared-providers',
  );
});

test('rejects a browser-only pixel kernel replacing the shared server renderer', () => {
  rejectsMutation(
    'apps/web/src/components/media/photo-editor/photo-editor-photon.ts',
    () => 'export function processPhotoPixels() { return new Uint8Array(); }',
    'shared-photo-render',
  );
});
