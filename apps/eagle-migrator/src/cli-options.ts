export type MigratorCommand = 'doctor' | 'inventory' | 'run' | 'resume' | 'status' | 'verify';

export interface CliOptions {
  command: MigratorCommand;
  snapshotPath: string;
  serverUrl: string;
  concurrency: number;
  stateDirectory?: string;
}

const COMMANDS = new Set<MigratorCommand>([
  'doctor',
  'inventory',
  'run',
  'resume',
  'status',
  'verify',
]);

export function parseCliOptions(arguments_: string[]): CliOptions {
  const [rawCommand, snapshotPath, ...rest] = arguments_;
  if (!COMMANDS.has(rawCommand as MigratorCommand) || !snapshotPath) {
    throw new Error(
      '用法：eagle-migrator <doctor|inventory|run|resume|status|verify> <snapshot-path> [options]',
    );
  }
  const options: CliOptions = {
    command: rawCommand as MigratorCommand,
    snapshotPath,
    serverUrl: 'http://localhost:8180',
    concurrency: 4,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (key === '--pat' || key === '--token' || key === '--password') {
      throw new Error(
        'Secrets must be supplied through the environment, never command-line arguments.',
      );
    }
    if (!value || value.startsWith('--')) throw new Error(`参数 ${key} 缺少值。`);
    if (key === '--server') options.serverUrl = normalizeServerUrl(value);
    else if (key === '--concurrency') {
      const concurrency = Number(value);
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
        throw new Error('concurrency must be between 1 and 16.');
      }
      options.concurrency = concurrency;
    } else if (key === '--state') options.stateDirectory = value;
    else throw new Error(`未知参数：${key}`);
    index += 1;
  }
  return options;
}

function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('服务器必须使用 HTTP(S)。');
  if (url.username || url.password) throw new Error('服务器 URL 不得包含凭据。');
  return url.toString().replace(/\/$/, '');
}
