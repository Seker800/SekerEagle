'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApiClient } = require('../js/api-client');
const { scanEagleLibrary } = require('../js/eagle-source');
const { ImportEngine, ImportPausedError } = require('../js/import-engine');
const { StateStore } = require('../js/state-store');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

test('resume processes recoverable UPLOADING items before new STAGED items', async () => {
  const requestedStatuses = [];
  const uploaded = [];
  const api = {
    iterateItems: async function* (_runId, status) {
      requestedStatuses.push(status);
      if (status === 'UPLOADING') {
        yield {
          id: 'resumable',
          sourceItemId: 'source-1',
          displayName: 'resume.jpg',
          action: 'NEW',
        };
      }
    },
    getRun: async () => ({ status: 'COMPLETED', stagedItemCount: 0 }),
    retryItem: async () => {},
  };
  const engine = new ImportEngine({
    api,
    store: { state: { activeRun: {} }, save: async () => {} },
  });
  engine.uploadItem = async (_runId, item) => uploaded.push(item.id);

  await engine.upload('run-1', new Map([['source-1', {}]]));

  assert.deepEqual(requestedStatuses, ['FAILED', 'UPLOADING', 'STAGED']);
  assert.deepEqual(uploaded, ['resumable']);
});

test('pauses after in-flight work and preserves the active run for a later resume', async () => {
  const uploaded = [];
  const saved = [];
  const store = {
    state: { activeRun: { runId: 'run-1', phase: 'UPLOADING' } },
    save: async (patch) => {
      saved.push(patch);
      Object.assign(store.state, patch);
    },
  };
  const api = {
    iterateItems: async function* (_runId, status) {
      if (status !== 'STAGED') return;
      yield { id: 'item-1', sourceItemId: 'source-1', displayName: 'one.jpg', action: 'NEW' };
      yield { id: 'item-2', sourceItemId: 'source-2', displayName: 'two.jpg', action: 'NEW' };
    },
    getRun: async () => ({ status: 'UPLOADING', stagedItemCount: 2 }),
    retryItem: async () => {},
  };
  const engine = new ImportEngine({ api, store, uploadConcurrency: 1 });
  engine.uploadItem = async (_runId, item) => {
    uploaded.push(item.id);
    engine.pauseLocally();
  };

  await assert.rejects(
    engine.upload(
      'run-1',
      new Map([
        ['source-1', {}],
        ['source-2', {}],
      ]),
    ),
    (error) => error instanceof ImportPausedError && error.code === 'IMPORT_PAUSED',
  );

  assert.deepEqual(uploaded, ['item-1']);
  assert.equal(store.state.activeRun.runId, 'run-1');
  assert.equal(store.state.activeRun.phase, 'PAUSED');
  assert.ok(saved.some((patch) => patch.activeRun?.phase === 'PAUSED'));
});

test('clears a previous pause before resuming manifest staging', async () => {
  const staged = [];
  const store = {
    state: { activeRun: { runId: 'run-1', phase: 'PAUSED' } },
    save: async (patch) => Object.assign(store.state, patch),
  };
  const api = {
    getRun: async () => ({ id: 'run-1', status: 'DRAFT' }),
    stageChunk: async (_runId, chunk) => staged.push(chunk.chunkKey),
    preflight: async () => ({ uploadItemCount: 1 }),
  };
  const engine = new ImportEngine({ api, store });
  engine.pauseLocally();

  await engine.resumePreparation(
    'run-1',
    {
      library: { path: '/library', name: 'Library' },
      folders: [],
      tags: [],
      tagGroups: [],
      items: [],
    },
    'library-1',
  );

  assert.deepEqual(staged, ['items-00001']);
  assert.equal(store.state.activeRun.phase, 'PREFLIGHTED');
});

test('coalesces concurrent 401 responses into one token refresh', async () => {
  let refreshRequests = 0;
  const client = new ApiClient({
    baseUrl: 'http://127.0.0.1:3100',
    accessToken: 'expired',
    refreshToken: 'refresh-1',
    minimumImportIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/auth/token/refresh')) {
        refreshRequests += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return response(200, { accessToken: 'fresh', refreshToken: 'refresh-2' });
      }
      return options.headers.Authorization === 'Bearer fresh'
        ? response(200, { ok: true })
        : response(401, { message: 'expired' });
    },
  });

  await Promise.all([client.getRun('run-1'), client.listLibraries()]);

  assert.equal(refreshRequests, 1);
});

test('serializes concurrent state writes and preserves every patch', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-state-queue-'));
  const store = new StateStore(directory);
  await store.load();

  await Promise.all([
    store.save({ serverUrl: 'https://chat.example.com' }),
    store.save({ email: 'owner@example.com' }),
  ]);

  const restored = new StateStore(directory);
  await restored.load();
  assert.equal(restored.state.serverUrl, 'https://chat.example.com');
  assert.equal(restored.state.email, 'owner@example.com');
});

test('never persists passwords or bearer tokens and scrubs legacy plaintext state', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-secret-state-'));
  const store = new StateStore(directory);
  await store.load();
  await store.save({ password: 'secret', accessToken: 'access', refreshToken: 'refresh' });

  const serialized = await fs.readFile(store.filePath, 'utf8');
  assert.doesNotMatch(serialized, /secret|access|refresh/);
  assert.equal(store.state.password, 'secret');
  assert.equal(store.state.refreshToken, 'refresh');

  await fs.writeFile(
    store.filePath,
    JSON.stringify({
      serverUrl: 'https://chat.example.com',
      password: 'legacy-password',
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
    }),
  );
  const restored = new StateStore(directory);
  await restored.load();
  assert.equal(restored.state.password, '');
  assert.equal(restored.state.accessToken, '');
  assert.equal(restored.state.refreshToken, '');
  assert.doesNotMatch(await fs.readFile(restored.filePath, 'utf8'), /legacy-/);
});

test('backs up a corrupt local state file and starts with safe defaults', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-corrupt-state-'));
  const store = new StateStore(userDataPath);
  await fs.mkdir(store.directory, { recursive: true });
  await fs.writeFile(store.filePath, '{broken json');

  await store.load();

  assert.equal(store.state.autoReconnect, true);
  assert.match(store.loadWarning, /已损坏/);
  const files = await fs.readdir(store.directory);
  assert.ok(files.some((file) => /^state\.corrupt-\d+\.json$/.test(file)));
  await assert.rejects(fs.access(store.filePath));
});

test('migrates the legacy hash cache into checksummed shards without touching the active run', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-cache-migration-'));
  const store = new StateStore(userDataPath);
  await fs.mkdir(store.directory, { recursive: true });
  await fs.writeFile(
    store.filePath,
    JSON.stringify({
      activeRun: { runId: 'run-live', libraryPath: '/library', phase: 'UPLOADING' },
      hashCache: {
        'asset-1': { key: '/one.jpg\u00001\u00001', sha256: 'a'.repeat(64) },
        'asset-2': { key: '/two.jpg\u00002\u00002', sha256: 'b'.repeat(64) },
      },
    }),
  );

  await store.load();

  assert.equal(store.state.activeRun.runId, 'run-live');
  assert.equal((await store.hashCache.get('asset-2')).sha256, 'b'.repeat(64));
  const serialized = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
  assert.equal(Object.hasOwn(serialized, 'hashCache'), false);
  assert.equal(
    JSON.parse(await fs.readFile(store.legacyStateBackupPath, 'utf8')).activeRun.runId,
    'run-live',
  );
});

test('isolates a corrupt hash shard and keeps resumable state available', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-cache-corrupt-'));
  const store = new StateStore(userDataPath);
  await store.load();
  await store.save({ activeRun: { runId: 'run-live', libraryPath: '/library', phase: 'PAUSED' } });
  await store.hashCache.set('asset-1', { key: '/one.jpg\u00001\u00001', sha256: 'a'.repeat(64) });
  await store.hashCache.flush();
  const shardPath = store.hashCache.shardPathFor('asset-1');
  await fs.writeFile(shardPath, '{broken shard');

  const restored = new StateStore(userDataPath);
  await restored.load();

  assert.equal(await restored.hashCache.get('asset-1'), undefined);
  assert.equal(restored.state.activeRun.runId, 'run-live');
  assert.match(restored.hashCache.warning, /缓存分片已损坏/);
});

test('passes Eagle trash state through the manifest without uploading the deleted file', async () => {
  const sourcePath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-trash-')),
    'trash.jpg',
  );
  await fs.writeFile(sourcePath, 'deleted');
  const eagleApi = {
    library: { path: path.dirname(sourcePath), name: 'Library' },
    folder: { getAll: async () => [] },
    tag: { get: async () => [] },
    tagGroup: { get: async () => [] },
    item: {
      getIdsWithModifiedAt: async () => [{ id: 'deleted-1', modifiedAt: 1 }],
      getByIds: async () => [
        {
          id: 'deleted-1',
          name: 'Trash',
          ext: 'jpg',
          filePath: sourcePath,
          isDeleted: true,
          size: 7,
          tags: [],
          folders: [],
        },
      ],
    },
  };

  const scan = await scanEagleLibrary({ eagleApi });

  assert.equal(scan.items[0].isDeleted, true);
  assert.equal(scan.items[0].size, 7);
  assert.equal(scan.byteSize, 7);
  assert.equal(scan.sourceFiles.has('deleted-1'), false);
});

test('scans into a resumable disk workspace without returning full item collections', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-streamed-scan-'));
  const sourcePath = path.join(directory, 'asset.jpg');
  await fs.writeFile(sourcePath, 'asset');
  const store = new StateStore(directory);
  await store.load();
  const workspace = await store.createScanWorkspace();
  const scan = await scanEagleLibrary({
    eagleApi: {
      library: { path: directory, name: 'Library' },
      folder: { getAll: async () => [] },
      tag: { get: async () => [] },
      tagGroup: { get: async () => [] },
      item: {
        getIdsWithModifiedAt: async () => [{ id: 'asset-1' }],
        getByIds: async () => [
          {
            id: 'asset-1',
            name: 'Asset',
            ext: 'jpg',
            filePath: sourcePath,
            isDeleted: false,
            tags: [],
            folders: [],
          },
        ],
      },
    },
    hashCacheStore: store.hashCache,
    workspace,
  });

  assert.equal(scan.itemCount, 1);
  assert.equal(Object.hasOwn(scan, 'items'), false);
  assert.equal(Object.hasOwn(scan, 'hashCache'), false);
  assert.equal((await scan.sourceFiles.get('asset-1')).filePath, sourcePath);
  const items = [];
  for await (const item of scan.iterateItems()) items.push(item.sourceItemId);
  assert.deepEqual(items, ['asset-1']);
  await scan.dispose();
});

test('skips empty files and removes stale folder references without aborting the scan', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-invalid-data-'));
  const emptyPath = path.join(directory, 'empty.jpg');
  const validPath = path.join(directory, 'valid.jpg');
  await fs.writeFile(emptyPath, '');
  await fs.writeFile(validPath, 'valid');
  const eagleApi = {
    library: { path: directory, name: 'Library' },
    folder: { getAll: async () => [{ id: 'known', name: 'Known' }] },
    tag: { get: async () => [] },
    tagGroup: { get: async () => [] },
    item: {
      getIdsWithModifiedAt: async () => [{ id: 'empty-1' }, { id: 'valid-1' }, { id: 'valid-1' }],
      getByIds: async () => [
        { id: 'empty-1', name: 'Empty', ext: 'jpg', filePath: emptyPath, tags: [], folders: [] },
        {
          id: 'valid-1',
          name: 'Valid',
          ext: 'jpg',
          filePath: validPath,
          tags: [],
          folders: ['known', 'missing'],
        },
      ],
    },
  };

  const scan = await scanEagleLibrary({ eagleApi });

  assert.deepEqual(
    scan.items.map((item) => item.sourceItemId),
    ['valid-1'],
  );
  assert.deepEqual(scan.items[0].folderIds, ['known']);
  assert.equal(scan.unreadableItemCount, 1);
  assert.equal(scan.unreadableItems[0].code, 'EMPTY_FILE');
  assert.equal(scan.dataWarningCount, 2);
  assert.match(scan.dataWarnings.join('\n'), /失效文件夹引用/);
});

test('keeps scanning when an Eagle source file is missing and retries it next time', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-missing-'));
  const missingPath = path.join(directory, 'missing.jpg');
  const readablePath = path.join(directory, 'readable.jpg');
  await fs.writeFile(readablePath, 'readable');
  const eagleApi = {
    library: { path: directory, name: 'Library' },
    folder: { getAll: async () => [] },
    tag: { get: async () => [] },
    tagGroup: { get: async () => [] },
    item: {
      getIdsWithModifiedAt: async () => [
        { id: 'missing-1', modifiedAt: 1 },
        { id: 'readable-1', modifiedAt: 1 },
      ],
      getByIds: async () => [
        {
          id: 'missing-1',
          name: 'Missing',
          ext: 'jpg',
          filePath: missingPath,
          isDeleted: false,
          tags: [],
          folders: [],
        },
        {
          id: 'readable-1',
          name: 'Readable',
          ext: 'jpg',
          filePath: readablePath,
          isDeleted: false,
          tags: [],
          folders: [],
        },
      ],
    },
  };

  const scan = await scanEagleLibrary({
    eagleApi,
    hashCache: { 'missing-1': { key: 'stale', sha256: 'a'.repeat(64) } },
  });

  assert.equal(scan.items.length, 1);
  assert.equal(scan.items[0].sourceItemId, 'readable-1');
  assert.equal(scan.byteSize, 8);
  assert.equal(scan.sourceFiles.has('missing-1'), false);
  assert.equal(scan.sourceFiles.has('readable-1'), true);
  assert.equal(scan.hashCache['missing-1'], undefined);
  assert.equal(scan.unreadableItemCount, 1);
  assert.deepEqual(
    scan.unreadableItems.map(({ sourceItemId, code }) => ({ sourceItemId, code })),
    [{ sourceItemId: 'missing-1', code: 'ENOENT' }],
  );
});

test('normalizes fractional filesystem timestamp fallbacks before manifest staging', async (context) => {
  const sourcePath = path.join(os.tmpdir(), 'fractional-time.jpg');
  context.mock.method(fs, 'stat', async () => ({
    isFile: () => true,
    size: 5,
    birthtimeMs: 1_200.75,
    mtimeMs: 1_234.875,
  }));
  const eagleApi = {
    library: { path: os.tmpdir(), name: 'Library' },
    folder: { getAll: async () => [] },
    tag: { get: async () => [] },
    tagGroup: { get: async () => [] },
    item: {
      getIdsWithModifiedAt: async () => [{ id: 'fractional-time-1' }],
      getByIds: async () => [
        {
          id: 'fractional-time-1',
          name: 'Fractional time',
          ext: 'jpg',
          filePath: sourcePath,
          isDeleted: false,
          tags: [],
          folders: [],
        },
      ],
    },
  };

  const scan = await scanEagleLibrary({
    eagleApi,
    hashCache: {
      'fractional-time-1': {
        key: `${sourcePath}\u00005\u00001234`,
        sha256: 'a'.repeat(64),
      },
    },
  });

  assert.equal(scan.items[0].importedAt, 1_200);
  assert.equal(scan.items[0].modifiedAt, 1_234);
  assert.equal(scan.items[0].sourceFileModifiedAt, 1_234);
});

test('keeps scanning when a source disappears while hashing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-unreadable-'));
  const eagleApi = {
    library: { path: directory, name: 'Library' },
    folder: { getAll: async () => [] },
    tag: { get: async () => [] },
    tagGroup: { get: async () => [] },
    item: {
      getIdsWithModifiedAt: async () => [{ id: 'directory-1', modifiedAt: 1 }],
      getByIds: async () => [
        {
          id: 'directory-1',
          name: 'Unreadable',
          ext: 'jpg',
          filePath: directory,
          isDeleted: false,
          tags: [],
          folders: [],
        },
      ],
    },
  };

  const scan = await scanEagleLibrary({ eagleApi });

  assert.equal(scan.items.length, 0);
  assert.equal(scan.sourceFiles.size, 0);
  assert.equal(scan.unreadableItemCount, 1);
  assert.ok(['NOT_A_FILE', 'READ_FAILED'].includes(scan.unreadableItems[0].code));
});

test('normalizes duplicate Eagle tags and item assignments before manifest staging', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seker-eagle-tags-'));
  const sourcePath = path.join(directory, 'tagged.jpg');
  await fs.writeFile(sourcePath, 'tagged');
  const eagleApi = {
    library: { path: directory, name: 'Library' },
    folder: { getAll: async () => [] },
    tag: { get: async () => [{ name: 'Jiema' }, { name: 'jiema', isStarred: true }] },
    tagGroup: { get: async () => [{ id: 'group-1', tags: ['JIEMA'] }] },
    item: {
      getIdsWithModifiedAt: async () => [{ id: 'tagged-1', modifiedAt: 1 }],
      getByIds: async () => [
        {
          id: 'tagged-1',
          name: 'Tagged',
          ext: 'jpg',
          filePath: sourcePath,
          isDeleted: false,
          tags: ['Jiema', 'jiema'],
          folders: [],
        },
      ],
    },
  };

  const scan = await scanEagleLibrary({ eagleApi });

  assert.equal(scan.tags.length, 1);
  assert.equal(scan.tags[0].name, 'jiema');
  assert.deepEqual(scan.items[0].tagNames, ['jiema']);
  assert.equal(scan.mergedTagCount, 1);
  assert.deepEqual(scan.mergedTagDetails, [
    {
      identity: 'jiema',
      names: ['Jiema', 'jiema'],
      selectedName: 'jiema',
    },
  ]);
});
