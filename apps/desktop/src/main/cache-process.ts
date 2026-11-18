import { app, utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { desktopCacheRoot } from './cache-location';
import { portableCacheRoot } from './portable-data';
import { CacheRpcClient, type CacheRpcEndpoint, type CacheRpcMessage } from '../shared/cache-rpc';
import { DEFAULT_CACHE_LIMIT_BYTES } from '../utility/cache/cache-policy';

let portableDataRoot: string | null = null;
let cacheProcess: UtilityProcess | null = null;
let cacheClient: CacheRpcClient | null = null;
let cacheLimitBytes = DEFAULT_CACHE_LIMIT_BYTES;
let cacheRestartTimer: NodeJS.Timeout | null = null;
let cacheRestartHistory: number[] = [];
let shuttingDown = false;

export function setPortableDataRoot(root: string | null): void {
  portableDataRoot = root;
}

export function setCacheLimitBytes(value: number): void {
  cacheLimitBytes = value;
}

export function currentDesktopCacheRoot(): string {
  if (portableDataRoot) return portableCacheRoot(portableDataRoot);
  return desktopCacheRoot({
    platform: process.platform,
    home: app.getPath('home'),
    appData: app.getPath('appData'),
    localAppData: process.env.LOCALAPPDATA,
    xdgCacheHome: process.env.XDG_CACHE_HOME,
  });
}

async function startCacheProcess(
  limitBytes = DEFAULT_CACHE_LIMIT_BYTES,
): Promise<{ child: UtilityProcess; client: CacheRpcClient }> {
  const child = utilityProcess.fork(path.join(__dirname, 'utility.cjs'), [], {
    serviceName: 'SekerEagle Media Cache',
  });
  const endpoint: CacheRpcEndpoint = {
    postMessage(message) {
      child.postMessage(message);
    },
    subscribe(listener) {
      const onMessage = (message: unknown) => listener(message as CacheRpcMessage);
      child.on('message', onMessage);
      return () => child.off('message', onMessage);
    },
  };
  const client = new CacheRpcClient(endpoint);
  try {
    await client.initialize({
      cacheRoot: currentDesktopCacheRoot(),
      limitBytes,
    });
  } catch (error) {
    client.disconnect(error instanceof Error ? error : undefined);
    child.kill();
    throw error;
  }
  return { child, client };
}

export async function connectCacheProcess(): Promise<void> {
  if (shuttingDown || cacheClient) return;
  try {
    const started = await startCacheProcess(cacheLimitBytes);
    if (shuttingDown) {
      started.client.disconnect();
      started.child.kill();
      return;
    }
    cacheClient = started.client;
    cacheProcess = started.child;
    started.child.once('exit', () => handleCacheProcessExit(started.child, started.client));
  } catch {
    scheduleCacheRestart();
  }
}

function handleCacheProcessExit(child: UtilityProcess, client: CacheRpcClient): void {
  client.disconnect();
  if (cacheProcess !== child) return;
  cacheProcess = null;
  cacheClient = null;
  scheduleCacheRestart();
}

function scheduleCacheRestart(): void {
  if (shuttingDown || cacheRestartTimer) return;
  const now = Date.now();
  cacheRestartHistory = cacheRestartHistory.filter((startedAt) => now - startedAt < 60_000);
  if (cacheRestartHistory.length >= 3) return;
  const delayMs = 250 * 2 ** cacheRestartHistory.length;
  cacheRestartHistory.push(now);
  cacheRestartTimer = setTimeout(() => {
    cacheRestartTimer = null;
    void connectCacheProcess();
  }, delayMs);
  cacheRestartTimer.unref();
}

export function currentCache(): CacheRpcClient {
  if (!cacheClient) throw new Error('本地缓存暂时不可用。');
  return cacheClient;
}

export function cacheBackend() {
  return {
    acquire: (...args: Parameters<CacheRpcClient['acquire']>) => currentCache().acquire(...args),
    release: (...args: Parameters<CacheRpcClient['release']>) => currentCache().release(...args),
    beginWrite: (...args: Parameters<CacheRpcClient['beginWrite']>) =>
      currentCache().beginWrite(...args),
    append: (...args: Parameters<CacheRpcClient['append']>) => currentCache().append(...args),
    commit: (...args: Parameters<CacheRpcClient['commit']>) => currentCache().commit(...args),
    abort: (...args: Parameters<CacheRpcClient['abort']>) => currentCache().abort(...args),
    renewAuthorization: (...args: Parameters<CacheRpcClient['renewAuthorization']>) =>
      currentCache().renewAuthorization(...args),
    invalidate: (...args: Parameters<CacheRpcClient['invalidate']>) =>
      currentCache().invalidate(...args),
    invalidateAsset: (...args: Parameters<CacheRpcClient['invalidateAsset']>) =>
      currentCache().invalidateAsset(...args),
  };
}

export async function expireCacheAuthorizations(): Promise<void> {
  await cacheClient?.expireAuthorizations().catch(() => undefined);
}

export function releaseCacheLease(leaseId: string): void {
  if (cacheClient) void cacheClient.release(leaseId).catch(() => undefined);
}

export function shutdownCache(): void {
  shuttingDown = true;
  if (cacheRestartTimer) clearTimeout(cacheRestartTimer);
  if (cacheClient) void cacheClient.close().catch(() => undefined);
  cacheProcess?.kill();
}
