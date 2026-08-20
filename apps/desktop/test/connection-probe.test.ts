import { describe, expect, it, vi } from 'vitest';
import { probeDesktopConnection } from '../src/main/connection-probe';

describe('desktop connection probe', () => {
  it('verifies trusted origin and deployment identity through the bootstrap endpoint', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ version: 1, deploymentId: 'a'.repeat(64) }),
    );
    const result = await probeDesktopConnection(
      fetcher,
      'LOCAL',
      'http://localhost:8180',
      { now: sequenceNow(100, 112), timeoutMs: 1_000 },
    );

    expect(result).toEqual({
      state: 'AVAILABLE',
      url: 'http://localhost:8180',
      latencyMs: 12,
      deploymentId: 'a'.repeat(64),
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8180/api/desktop/bootstrap',
      expect.objectContaining({
        method: 'GET',
        headers: { origin: 'http://localhost:8180', 'cache-control': 'no-store' },
        redirect: 'error',
      }),
    );
  });

  it.each([
    [403, 'UNTRUSTED'],
    [404, 'INCOMPATIBLE'],
    [500, 'UNREACHABLE'],
  ] as const)('classifies HTTP %s without exposing response bodies', async (status, state) => {
    const result = await probeDesktopConnection(
      async () => new Response('sensitive upstream detail', { status }),
      'PUBLIC',
      'https://eagle.example.com',
      { now: sequenceNow(0, 5), timeoutMs: 1_000 },
    );
    expect(result.state).toBe(state);
    expect(result.message).not.toContain('sensitive');
  });

  it('rejects malformed bootstrap payloads and bounds network failures', async () => {
    const malformed = await probeDesktopConnection(
      async () => Response.json({ version: 2, deploymentId: 'short' }),
      'LAN',
      'https://eagle.lan.example',
      { now: sequenceNow(0, 1), timeoutMs: 1_000 },
    );
    expect(malformed.state).toBe('INCOMPATIBLE');

    const offline = await probeDesktopConnection(
      async () => {
        throw new Error('DNS includes private details');
      },
      'LAN',
      'https://eagle.lan.example',
      { now: sequenceNow(0, 1), timeoutMs: 1_000 },
    );
    expect(offline).toMatchObject({ state: 'UNREACHABLE', message: '无法连接服务器。' });
  });
});

function sequenceNow(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}
