import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CONNECTION_SETTINGS,
  normalizeConnectionSettings,
  type DesktopConnectionSettings,
} from './connection-config';

export class DesktopConnectionSettingsStore {
  private readonly filePath: string;

  constructor(settingsDirectory: string) {
    this.filePath = path.join(settingsDirectory, 'connection-settings.json');
  }

  async load(): Promise<DesktopConnectionSettings> {
    try {
      return normalizeConnectionSettings(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
        return { ...DEFAULT_CONNECTION_SETTINGS };
      }
      throw error;
    }
  }

  async save(input: unknown): Promise<DesktopConnectionSettings> {
    const settings = normalizeConnectionSettings(input);
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(settings)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.filePath);
    return settings;
  }
}
