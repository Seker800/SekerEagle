import { access, mkdir, stat, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseCliOptions } from './cli-options';
import { MigrationJournal } from './journal';
import { doctorServer, runSnapshotMigration, verifyRemoteMigration } from './runner';
import { redactSensitiveText } from './secrets';
import { openMigrationSnapshot, type MigrationSnapshot } from './snapshot';

export interface CliRuntime {
  environment?: NodeJS.ProcessEnv;
  write?: (message: string) => void;
}

export async function executeCli(arguments_: string[], runtime: CliRuntime = {}): Promise<void> {
  const options = parseCliOptions(arguments_);
  const write = runtime.write ?? console.log;
  const environment = runtime.environment ?? process.env;
  const snapshot = await openMigrationSnapshot(resolve(options.snapshotPath));

  if (options.command === 'inventory') {
    write(JSON.stringify(inventoryOf(snapshot), null, 2));
    return;
  }
  if (options.command === 'doctor') {
    const pat = requirePat(environment);
    const fileSystem = await statfs(snapshot.header.library.rootPath);
    await doctorServer({ serverUrl: options.serverUrl, pat });
    write(
      JSON.stringify(
        {
          ok: true,
          migrationId: snapshot.header.migrationId,
          sourceReadable: true,
          sourceItemCount: snapshot.header.itemCount,
          sourceByteSize: snapshot.header.byteSize,
          localFreeByteSize: fileSystem.bavail * fileSystem.bsize,
          serverReachable: true,
          authenticated: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  const stateDirectory = resolveStateDirectory(options.stateDirectory, snapshot.header.migrationId);
  const journalPath = join(stateDirectory, 'journal.sqlite');
  if (options.command === 'run' || options.command === 'resume') {
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  } else {
    await access(journalPath);
  }
  await assertSecureStateDirectory(stateDirectory);
  const journal = MigrationJournal.open(journalPath, {
    migrationId: snapshot.header.migrationId,
    snapshotSha256: snapshot.header.snapshotSha256,
  });
  try {
    if (options.command === 'status') {
      write(
        JSON.stringify({ activeRun: journal.loadActiveRun(), items: journal.summary() }, null, 2),
      );
      return;
    }
    const pat = requirePat(environment);
    if (options.command === 'verify') {
      write(
        JSON.stringify(
          await verifyRemoteMigration({ journal, serverUrl: options.serverUrl, pat }),
          null,
          2,
        ),
      );
      return;
    }
    const result = await runSnapshotMigration({
      snapshot,
      journal,
      serverUrl: options.serverUrl,
      pat,
      concurrency: options.concurrency,
      log: (message) => write(redactSensitiveText(message)),
    });
    write(JSON.stringify(result, null, 2));
  } finally {
    journal.close();
  }
}

export async function assertSecureStateDirectory(directory: string): Promise<void> {
  const directoryStat = await stat(directory);
  if (!directoryStat.isDirectory()) throw new Error('迁移 state 路径不是目录。');
  if ((directoryStat.mode & 0o077) !== 0) {
    throw new Error('迁移 state 目录权限必须是 0700，避免 SQLite 恢复日志泄露。');
  }
}

export function resolveStateDirectory(value: string | undefined, migrationId: string): string {
  return resolve(
    value ?? join(homedir(), '.local', 'share', 'sekereagle', 'migrations', migrationId),
  );
}

export function requirePat(environment: NodeJS.ProcessEnv): string {
  const pat = environment.SEKEREAGLE_PAT;
  if (!pat?.startsWith('se_pat_')) {
    throw new Error('请通过环境变量 SEKEREAGLE_PAT 提供 SekerEagle PAT。');
  }
  return pat;
}

export function inventoryOf(snapshot: MigrationSnapshot): Record<string, unknown> {
  return {
    migrationId: snapshot.header.migrationId,
    snapshotSha256: snapshot.header.snapshotSha256,
    libraryName: snapshot.header.library.name,
    libraryRoot: snapshot.header.library.rootPath,
    sourceModifiedAt: snapshot.header.library.sourceModifiedAt,
    itemCount: snapshot.header.itemCount,
    byteSize: snapshot.header.byteSize,
    folderCount: snapshot.folders.length,
    tagCount: snapshot.tags.length,
    tagGroupCount: snapshot.tagGroups.length,
  };
}
