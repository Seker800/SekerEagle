import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONNECTION_SETTINGS,
  normalizeConnectionSettings,
} from '../src/main/connection-config';
import { DesktopConnectionSettingsStore } from '../src/main/connection-settings';

describe('desktop connection settings', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true, force: true })),
      ),
    );
  });

  it('defaults to automatic local-first selection', () => {
    expect(DEFAULT_CONNECTION_SETTINGS).toEqual({
      mode: 'AUTO',
      localUrl: 'http://localhost:8180',
      lanUrl: '',
      publicUrl: '',
      allowInsecureLan: false,
      deploymentId: null,
      activeSlot: null,
    });
  });

  it('normalizes loopback aliases and validates each connection class independently', () => {
    expect(
      normalizeConnectionSettings({
        mode: 'AUTO',
        localUrl: 'http://127.0.0.1:8180/',
        lanUrl: 'http://192.168.31.139:8180',
        publicUrl: 'https://eagle.example.com/',
        allowInsecureLan: true,
      }),
    ).toMatchObject({
      localUrl: 'http://localhost:8180',
      lanUrl: 'http://192.168.31.139:8180',
      publicUrl: 'https://eagle.example.com',
    });
  });

  it('rejects insecure public targets, unapproved LAN HTTP, paths, credentials and protected hosts', () => {
    const invalid = [
      { lanUrl: 'http://192.168.31.139:8180', allowInsecureLan: false },
      { publicUrl: 'http://example.com' },
      { publicUrl: 'https://example.com/path' },
      { publicUrl: 'https://user:password@example.com' },
      { lanUrl: 'http://192.168.31.89:8180', allowInsecureLan: true },
      { localUrl: 'http://192.168.31.139:8180' },
    ];
    for (const candidate of invalid) {
      expect(() => normalizeConnectionSettings(candidate)).toThrow();
    }
  });

  it('requires the manually selected slot to be configured', () => {
    expect(() => normalizeConnectionSettings({ mode: 'LAN', lanUrl: '' })).toThrow(
      '所选连接地址尚未配置',
    );
  });

  it('persists validated settings atomically with private permissions and recovers malformed JSON', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-connections-'));
    directories.push(directory);
    const store = new DesktopConnectionSettingsStore(directory);
    const saved = await store.save({
      mode: 'AUTO',
      lanUrl: 'https://eagle.lan.example',
      publicUrl: 'https://eagle.example.com',
    });
    expect(await store.load()).toEqual(saved);
    const settingsPath = path.join(directory, 'connection-settings.json');
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).not.toHaveProperty('password');

    await chmod(settingsPath, 0o600);
    await writeFile(settingsPath, '{broken', 'utf8');
    await expect(store.load()).resolves.toEqual(DEFAULT_CONNECTION_SETTINGS);
  });
});
