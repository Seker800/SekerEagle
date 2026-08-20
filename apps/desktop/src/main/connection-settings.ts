import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CONNECTION_SETTINGS,
  normalizeConnectionSettings,
  type DesktopConnectionSettings,
} from './connection-config';

export class DesktopConnectionSettingsStore {
  private readonly filePath: string;
  private readonly defaults: DesktopConnectionSettings;

  constructor(
    settingsDirectory: string,
    defaults: DesktopConnectionSettings = DEFAULT_CONNECTION_SETTINGS,
  ) {
    this.filePath = path.join(settingsDirectory, 'connection-settings.json');
    this.defaults = normalizeConnectionSettings(defaults);
  }

  async load(): Promise<DesktopConnectionSettings> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...this.defaults };
      throw error;
    }
    try {
      return normalizeConnectionSettings(JSON.parse(contents));
    } catch {
      return { ...this.defaults };
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
