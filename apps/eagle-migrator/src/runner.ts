import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createItemReporter } from './item-reporter';
import type { ActiveRunState, MigrationJournal } from './journal';
import { isSekerEaglePat } from './pat';
import type { MigrationSnapshot, SnapshotItem } from './snapshot';

interface SourceFile {
  filePath: string;
  size: number;
  mimeType: string;
  originalFileName: string;
}

interface PreparedScan {
  scan: {
    library: { name: string; path: string; sourceModifiedAt: string };
    itemCount: number;
    byteSize: number;
    folders: unknown[];
    tags: unknown[];
    tagGroups: unknown[];
    iterateItems(): AsyncGenerator<Record<string, unknown>>;
  };
  sourceFiles: { get(sourceItemId: string): Promise<SourceFile | null> };
}

interface ApiLike {
  request(path: string): Promise<unknown>;
  listLibraries(): Promise<unknown>;
  getRun(runId: string): Promise<{ id: string; status: string }>;
  iterateItems(runId: string, status: string): AsyncGenerator<ServerImportItem>;
}

interface ServerImportItem {
  sourceItemId: string;
  assetId?: string | null;
  action?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

interface EngineLike {
  prepare(
    scan: PreparedScan['scan'],
    externalLibraryId: string,
  ): Promise<{
    run: { id: string };
    preflight: { uploadItemCount: number };
  }>;
  resumePreparation(
    runId: string,
    scan: PreparedScan['scan'],
    externalLibraryId: string,
  ): Promise<{ preflight: { uploadItemCount: number } }>;
  upload(runId: string, sourceFiles: PreparedScan['sourceFiles']): Promise<{ status: string }>;
  pauseLocally(): void;
}

export async function prepareSnapshotForMigration(
  snapshot: MigrationSnapshot,
  journal: MigrationJournal,
): Promise<PreparedScan> {
  const sources = new Map<string, SourceFile>();
  let batch: Array<{ sourceItemId: string; contentSha256: string }> = [];
  for await (const item of snapshot.iterateItems()) {
    const contentSha256 =
      item.contentSha256 ??
      createHash('sha256').update(`deleted\0${item.sourceItemId}`).digest('hex');
    batch.push({ sourceItemId: item.sourceItemId, contentSha256 });
    if (item.isDeleted) {
      if (batch.length >= 500) {
        journal.registerItems(batch);
        batch = [];
      }
      continue;
    }
    if (!item.sourcePath || !item.contentSha256) {
      throw new Error(`迁移项 ${item.sourceItemId} 缺少源文件或内容哈希。`);
    }
    sources.set(item.sourceItemId, {
      filePath: item.sourcePath,
      size: item.size,
      mimeType: requireString(item, 'mimeType'),
      originalFileName: requireString(item, 'originalFileName'),
    });
    if (batch.length >= 500) {
      journal.registerItems(batch);
      batch = [];
    }
  }
  if (batch.length) journal.registerItems(batch);
  for await (const item of snapshot.iterateItems()) {
    if (item.isDeleted) {
      journal.markSkipped(item.sourceItemId, {
        code: 'SKIP_DELETED',
        message: 'Eagle 源记录已删除，仅保留在迁移清单中。',
      });
    }
  }

  return {
    scan: {
      library: {
        name: snapshot.header.library.name,
        path: snapshot.header.library.rootPath,
        sourceModifiedAt: snapshot.header.library.sourceModifiedAt,
      },
      itemCount: snapshot.header.itemCount,
      byteSize: snapshot.header.byteSize,
      folders: snapshot.folders,
      tags: snapshot.tags,
      tagGroups: snapshot.tagGroups,
      iterateItems: () => iterateServerItems(snapshot),
    },
    sourceFiles: { get: (sourceItemId) => Promise.resolve(sources.get(sourceItemId) ?? null) },
  };
}

export async function runSnapshotMigration(input: {
  snapshot: MigrationSnapshot;
  journal: MigrationJournal;
  serverUrl: string;
  pat: string;
  concurrency: number;
  log?: (message: string) => void;
}): Promise<{ status: string; summary: Record<string, number> }> {
  if (!isSekerEaglePat(input.pat)) throw new Error('SEKEREAGLE_PAT 不是有效的 SekerEagle PAT。');
  const log = input.log ?? (() => undefined);
  const prepared = await prepareSnapshotForMigration(input.snapshot, input.journal);
  const interrupted = input.journal.recoverInterrupted();
  if (interrupted) log(`已恢复 ${interrupted} 个被中断的本地迁移项。`);
  const { ImportEngine } = loadPluginRuntime();
  const api = createApi(input.serverUrl, input.pat);
  await api.request('/auth/me');
  await api.listLibraries();
  const store = journalStateStore(input.journal);
  const engine = new ImportEngine({
    api,
    store,
    log,
    itemState: createItemReporter(input.journal),
    uploadConcurrency: input.concurrency,
  }) as EngineLike;
  const externalLibraryId = input.snapshot.header.migrationId;
  let runId = store.state.activeRun?.runId;
  if (!runId) {
    const preparedRun = await engine.prepare(prepared.scan, externalLibraryId);
    runId = preparedRun.run.id;
  } else {
    const run = await api.getRun(runId);
    if (run.status === 'DRAFT') {
      await engine.resumePreparation(runId, prepared.scan, externalLibraryId);
    }
  }
  const run = await uploadWithGracefulSignals(engine, runId, prepared.sourceFiles, log);
  await reconcileServerItems(api, runId, input.journal);
  return { status: run.status, summary: input.journal.summary() };
}

export async function doctorServer(input: { serverUrl: string; pat: string }): Promise<void> {
  if (!isSekerEaglePat(input.pat)) throw new Error('SEKEREAGLE_PAT 不是有效的 SekerEagle PAT。');
  const api = createApi(input.serverUrl, input.pat);
  await api.request('/auth/me');
  await api.listLibraries();
}

export async function verifyRemoteMigration(input: {
  journal: MigrationJournal;
  serverUrl: string;
  pat: string;
}): Promise<{ run: { id: string; status: string }; summary: Record<string, number> }> {
  if (!isSekerEaglePat(input.pat)) throw new Error('SEKEREAGLE_PAT 不是有效的 SekerEagle PAT。');
  const runId = input.journal.loadServerRunId();
  if (!runId) throw new Error('本地 journal 没有可核验的服务端迁移任务。');
  return verifyMigration(createApi(input.serverUrl, input.pat), runId, input.journal);
}

export async function verifyMigration(
  api: ApiLike,
  runId: string,
  journal: MigrationJournal,
): Promise<{ run: { id: string; status: string }; summary: Record<string, number> }> {
  await reconcileServerItems(api, runId, journal);
  return { run: await api.getRun(runId), summary: journal.summary() };
}

async function* iterateServerItems(
  snapshot: MigrationSnapshot,
): AsyncGenerator<Record<string, unknown>> {
  for await (const item of snapshot.iterateItems()) {
    const { sourcePath: _sourcePath, ...manifestItem } = item;
    void _sourcePath;
    yield manifestItem;
  }
}

async function reconcileServerItems(
  api: ApiLike,
  runId: string,
  journal: MigrationJournal,
): Promise<void> {
  for await (const item of api.iterateItems(runId, 'IMPORTED')) {
    if (item.assetId) journal.reconcileImported(item.sourceItemId, { assetId: item.assetId });
  }
  for await (const item of api.iterateItems(runId, 'SKIPPED')) {
    journal.markSkipped(item.sourceItemId, {
      code: item.action ?? 'SKIPPED',
      message: '服务端预检跳过该 Eagle 记录。',
    });
  }
  for await (const item of api.iterateItems(runId, 'FAILED')) {
    const current = journal.get(item.sourceItemId);
    if (current && current.status !== 'REJECTED') {
      journal.markRejected(item.sourceItemId, {
        code: item.errorCode ?? 'SERVER_IMPORT_FAILED',
        message: item.errorMessage ?? '服务端导入失败。',
      });
    }
  }
}

function journalStateStore(journal: MigrationJournal): {
  state: { activeRun: ActiveRunState | null };
  save(patch: { activeRun?: ActiveRunState | null }): Promise<{ activeRun: ActiveRunState | null }>;
} {
  const state = { activeRun: journal.loadActiveRun() };
  return {
    state,
    save: (patch) => {
      if (Object.hasOwn(patch, 'activeRun')) {
        journal.saveActiveRun(patch.activeRun ?? null);
        state.activeRun = patch.activeRun ?? null;
      }
      return Promise.resolve(state);
    },
  };
}

function loadPluginRuntime(): {
  ApiClient: new (input: Record<string, unknown>) => unknown;
  ImportEngine: new (input: Record<string, unknown>) => unknown;
} {
  const require = createRequire(__filename);
  const pluginRoot = resolve(__dirname, '../../../plugins/eagle-importer/js');
  const apiModule = require(resolve(pluginRoot, 'api-client.js')) as {
    ApiClient: new (input: Record<string, unknown>) => unknown;
  };
  const engineModule = require(resolve(pluginRoot, 'import-engine.js')) as {
    ImportEngine: new (input: Record<string, unknown>) => unknown;
  };
  return { ApiClient: apiModule.ApiClient, ImportEngine: engineModule.ImportEngine };
}

function createApi(serverUrl: string, pat: string): ApiLike {
  const { ApiClient } = loadPluginRuntime();
  return new ApiClient({
    baseUrl: serverUrl,
    accessToken: pat,
    minimumImportIntervalMs: 550,
  }) as ApiLike;
}

async function uploadWithGracefulSignals(
  engine: EngineLike,
  runId: string,
  sourceFiles: PreparedScan['sourceFiles'],
  log: (message: string) => void,
): Promise<{ status: string }> {
  let stopping = false;
  const pause = () => {
    if (stopping) return;
    stopping = true;
    log('收到停止信号，正在安全暂停；再次运行 resume 可继续。');
    engine.pauseLocally();
  };
  process.once('SIGINT', pause);
  process.once('SIGTERM', pause);
  try {
    return await engine.upload(runId, sourceFiles);
  } finally {
    process.removeListener('SIGINT', pause);
    process.removeListener('SIGTERM', pause);
  }
}

function requireString(item: SnapshotItem, key: string): string {
  const value = item[key];
  if (typeof value !== 'string' || !value)
    throw new Error(`迁移项 ${item.sourceItemId} 缺少 ${key}。`);
  return value;
}
