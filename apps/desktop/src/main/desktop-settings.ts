import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CACHE_LIMIT_BYTES,
  GIBIBYTE,
  normalizeCacheLimitGiB,
} from '../utility/cache/cache-policy';

export interface DesktopSettings {
  cacheLimitBytes: number;
}

export class DesktopSettingsStore {
  private readonly filePath: string;

  constructor(settingsDirectory: string) {
    this.filePath = path.join(settingsDirectory, 'desktop-settings.json');
  }

  async load(): Promise<DesktopSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, unknown>;
      const limitGiB = normalizeCacheLimitGiB(parsed.cacheLimitGiB as number | undefined);
      return { cacheLimitBytes: limitGiB * GIBIBYTE };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
        return { cacheLimitBytes: DEFAULT_CACHE_LIMIT_BYTES };
      }
      throw error;
    }
  }

  async setCacheLimitGiB(cacheLimitGiB: number): Promise<DesktopSettings> {
    const normalized = normalizeCacheLimitGiB(cacheLimitGiB);
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${JSON.stringify({ cacheLimitGiB: normalized })}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
    return { cacheLimitBytes: normalized * GIBIBYTE };
  }
}
