import { describe, expect, it, vi } from 'vitest';
import {
  DesktopConnectionResolver,
  type ConnectionProbe,
  type ConnectionProbeResult,
} from '../src/main/connection-resolver';
import { normalizeConnectionSettings } from '../src/main/connection-config';

const DEPLOYMENT_A = 'a'.repeat(64);
const DEPLOYMENT_B = 'b'.repeat(64);

function available(
  url: string,
  deploymentId = DEPLOYMENT_A,
  latencyMs = 10,
): ConnectionProbeResult {
  return { state: 'AVAILABLE', url, deploymentId, latencyMs };
}

describe('desktop connection resolver', () => {
  it('keeps the current healthy connection sticky in automatic mode', async () => {
    const probe = vi.fn<ConnectionProbe>(async (_slot, url) => available(url));
    const resolver = new DesktopConnectionResolver(probe);
    const settings = normalizeConnectionSettings({
      localUrl: 'http://localhost:8180',
      publicUrl: 'https://eagle.example.com',
      activeSlot: 'PUBLIC',
      deploymentId: DEPLOYMENT_A,
    });

    const result = await resolver.resolve(settings);

    expect(result.active?.slot).toBe('PUBLIC');
    expect(probe).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledWith('PUBLIC', 'https://eagle.example.com');
  });

  it('probes all configured fallbacks concurrently and chooses local before LAN before public', async () => {
    const pending: Array<() => void> = [];
    const probe = vi.fn<ConnectionProbe>(
      (slot, url) =>
        new Promise((resolve) => {
          pending.push(() =>
            resolve(
              slot === 'LAN'
                ? { state: 'UNREACHABLE', url, latencyMs: 30, message: 'offline' }
                : available(url, DEPLOYMENT_A, slot === 'LOCAL' ? 20 : 5),
            ),
          );
        }),
    );
    const resolver = new DesktopConnectionResolver(probe);
    const resolving = resolver.resolve(
      normalizeConnectionSettings({
        localUrl: 'http://localhost:8180',
        lanUrl: 'https://eagle.lan.example',
        publicUrl: 'https://eagle.example.com',
      }),
    );
    expect(probe).toHaveBeenCalledTimes(3);
    pending.reverse().forEach((release) => release());

    const result = await resolving;
    expect(result.active?.slot).toBe('LOCAL');
    expect(result.probes).toHaveLength(3);
  });

  it('rejects reachable endpoints from a different deployment', async () => {
    const probe = vi.fn<ConnectionProbe>(async (slot, url) =>
      available(url, slot === 'LOCAL' ? DEPLOYMENT_B : DEPLOYMENT_A),
    );
    const resolver = new DesktopConnectionResolver(probe);
    const result = await resolver.resolve(
      normalizeConnectionSettings({
        deploymentId: DEPLOYMENT_A,
        localUrl: 'http://localhost:8180',
        publicUrl: 'https://eagle.example.com',
      }),
    );

    expect(result.active?.slot).toBe('PUBLIC');
    expect(result.probes.find((item) => item.slot === 'LOCAL')?.state).toBe('DIFFERENT_DEPLOYMENT');
  });

  it('manual mode probes only the selected endpoint and does not silently fall back', async () => {
    const probe = vi.fn<ConnectionProbe>(async (_slot, url) => ({
      state: 'UNREACHABLE',
      url,
      latencyMs: 10,
      message: 'offline',
    }));
    const resolver = new DesktopConnectionResolver(probe);
    const result = await resolver.resolve(
      normalizeConnectionSettings({
        mode: 'PUBLIC',
        localUrl: 'http://localhost:8180',
        publicUrl: 'https://eagle.example.com',
      }),
    );

    expect(result.active).toBeNull();
    expect(probe).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledWith('PUBLIC', 'https://eagle.example.com');
  });
});
