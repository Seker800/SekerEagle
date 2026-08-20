import type { ConnectionProbe, ConnectionProbeResult } from './connection-resolver';

const DEPLOYMENT_ID = /^[0-9a-f]{64}$/u;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function createDesktopConnectionProbe(
  fetcher: Fetcher,
  options: { timeoutMs?: number } = {},
): ConnectionProbe {
  return (slot, url) => probeDesktopConnection(fetcher, slot, url, options);
}

export async function probeDesktopConnection(
  fetcher: Fetcher,
  _slot: Parameters<ConnectionProbe>[0],
  url: string,
  options: { timeoutMs?: number; now?: () => number } = {},
): Promise<ConnectionProbeResult> {
  const timeoutMs = options.timeoutMs ?? 2_500;
  const now = options.now ?? performance.now.bind(performance);
  const startedAt = now();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetcher(new URL('/api/desktop/bootstrap', url).toString(), {
      method: 'GET',
      headers: { origin: url, 'cache-control': 'no-store' },
      credentials: 'omit',
      redirect: 'error',
      signal: abort.signal,
    });
    const latencyMs = elapsed(startedAt, now());
    if (response.status === 403) {
      return {
        state: 'UNTRUSTED',
        url,
        latencyMs,
        message: '服务器尚未信任这个访问地址。',
      };
    }
    if (response.status >= 500) {
      return { state: 'UNREACHABLE', url, latencyMs, message: '服务器暂时不可用。' };
    }
    if (!response.ok) {
      return { state: 'INCOMPATIBLE', url, latencyMs, message: '服务器版本不兼容。' };
    }
    const payload = (await response.json().catch(() => null)) as {
      version?: unknown;
      deploymentId?: unknown;
    } | null;
    if (
      payload?.version !== 1 ||
      typeof payload.deploymentId !== 'string' ||
      !DEPLOYMENT_ID.test(payload.deploymentId)
    ) {
      return { state: 'INCOMPATIBLE', url, latencyMs, message: '服务器身份响应无效。' };
    }
    return {
      state: 'AVAILABLE',
      url,
      latencyMs,
      deploymentId: payload.deploymentId,
    };
  } catch (error) {
    return {
      state: 'UNREACHABLE',
      url,
      latencyMs: elapsed(startedAt, now()),
      message: isAbort(error) ? '连接超时。' : '无法连接服务器。',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.round((endedAt - startedAt) * 10) / 10);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
