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
      directories
        .splice(0)
        .map((directory) =>
          import('node:fs/promises').then(({ rm }) =>
            rm(directory, { recursive: true, force: true }),
          ),
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
      allowInsecurePublicHttp: false,
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
        allowInsecurePublicHttp: false,
      }),
    ).toMatchObject({
      localUrl: 'http://localhost:8180',
      lanUrl: 'http://192.168.31.139:8180',
      publicUrl: 'https://eagle.example.com',
    });
  });

  it('allows an exact public HTTP origin only after an explicit client-side risk opt-in', () => {
    expect(
      normalizeConnectionSettings({
        mode: 'PUBLIC',
        publicUrl: 'http://yuntai.design:8180/',
        allowInsecurePublicHttp: true,
      }),
    ).toMatchObject({
      publicUrl: 'http://yuntai.design:8180',
      allowInsecurePublicHttp: true,
    });

    expect(
      normalizeConnectionSettings({
        mode: 'AUTO',
        localUrl: 'http://localhost:8180',
        lanUrl: '',
        publicUrl: 'http://yuntai.design:8180/',
        allowInsecureLan: false,
        allowInsecurePublicHttp: true,
      }),
    ).toMatchObject({
      localUrl: 'http://localhost:8180',
      publicUrl: 'http://yuntai.design:8180',
      allowInsecurePublicHttp: true,
    });
  });

  it('identifies the invalid connection field and rejects pasted trailing punctuation', () => {
    expect(() =>
      normalizeConnectionSettings({
        publicUrl: 'http://yuntai.design:8180/？',
        allowInsecurePublicHttp: true,
      }),
    ).toThrow('外网地址不能包含子路径或末尾标点');
    expect(() => normalizeConnectionSettings({ lanUrl: 'not a url' })).toThrow('局域网地址无效');
  });

  it('rejects unapproved public and LAN HTTP, paths, credentials and protected hosts', () => {
    const invalid = [
      { lanUrl: 'http://192.168.31.139:8180', allowInsecureLan: false },
      { publicUrl: 'http://example.com' },
      {
        publicUrl: 'http://user:password@example.com',
        allowInsecurePublicHttp: true,
      },
      {
        publicUrl: 'http://example.com/path',
        allowInsecurePublicHttp: true,
      },
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
    if (process.platform !== 'win32') expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).not.toHaveProperty('password');

    await chmod(settingsPath, 0o600);
    await writeFile(settingsPath, '{broken', 'utf8');
    await expect(store.load()).resolves.toEqual(DEFAULT_CONNECTION_SETTINGS);

    await writeFile(
      settingsPath,
      JSON.stringify({ mode: 'AUTO', publicUrl: 'http://example.com' }),
      'utf8',
    );
    await expect(store.load()).resolves.toEqual(DEFAULT_CONNECTION_SETTINGS);

    await writeFile(settingsPath, JSON.stringify({ mode: 'LAN', lanUrl: 42 }), 'utf8');
    await expect(store.load()).resolves.toEqual(DEFAULT_CONNECTION_SETTINGS);
  });

  it('uses an explicit legacy server URL only until connection settings are persisted', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-connections-'));
    directories.push(directory);
    const seeded = new DesktopConnectionSettingsStore(directory, {
      ...DEFAULT_CONNECTION_SETTINGS,
      localUrl: '',
      publicUrl: 'https://eagle.example.com',
    });

    await expect(seeded.load()).resolves.toMatchObject({
      localUrl: '',
      publicUrl: 'https://eagle.example.com',
    });
    await seeded.save(DEFAULT_CONNECTION_SETTINGS);
    await expect(seeded.load()).resolves.toEqual(DEFAULT_CONNECTION_SETTINGS);
  });
});
