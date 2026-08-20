import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DesktopSettingsStore } from '../src/main/desktop-settings';
import { DEFAULT_CACHE_LIMIT_BYTES, GIBIBYTE } from '../src/utility/cache/cache-policy';

describe('DesktopSettingsStore', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-settings-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('defaults to 10 GiB and persists an atomic validated capacity setting', async () => {
    const settings = new DesktopSettingsStore(directory);
    await expect(settings.load()).resolves.toEqual({ cacheLimitBytes: DEFAULT_CACHE_LIMIT_BYTES });
    await settings.setCacheLimitGiB(25);

    const reloaded = new DesktopSettingsStore(directory);
    await expect(reloaded.load()).resolves.toEqual({ cacheLimitBytes: 25 * GIBIBYTE });
  });

  it('rejects non-integer and out-of-range capacities', async () => {
    const settings = new DesktopSettingsStore(directory);
    await expect(settings.setCacheLimitGiB(0)).rejects.toThrow(/1.*100/);
    await expect(settings.setCacheLimitGiB(101)).rejects.toThrow(/1.*100/);
    await expect(settings.setCacheLimitGiB(1.5)).rejects.toThrow(/整数/);
  });
});
