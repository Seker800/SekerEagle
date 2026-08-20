import { describe, expect, it, vi } from 'vitest';
import { DesktopConnectionService } from '../src/main/connection-service';
import { DEFAULT_CONNECTION_SETTINGS } from '../src/main/connection-config';

const DEPLOYMENT_A = 'a'.repeat(64);
const DEPLOYMENT_B = 'b'.repeat(64);

describe('desktop connection service', () => {
  it('pins the first selected deployment and active slot atomically', async () => {
    const store = memoryStore();
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        active: {
          slot: 'LOCAL',
          url: 'http://localhost:8180',
          latencyMs: 8,
          deploymentId: DEPLOYMENT_A,
        },
        probes: [],
      }),
    };
    const service = new DesktopConnectionService(store, resolver);

    const snapshot = await service.initialize();

    expect(snapshot.settings).toMatchObject({ deploymentId: DEPLOYMENT_A, activeSlot: 'LOCAL' });
    expect(store.save).toHaveBeenCalledWith(snapshot.settings);
  });

  it('never accepts deployment identity or active slot from untrusted renderer input', async () => {
    const store = memoryStore({
      ...DEFAULT_CONNECTION_SETTINGS,
      deploymentId: DEPLOYMENT_A,
      activeSlot: 'LOCAL',
    });
    const resolver = {
      resolve: vi.fn(async (settings) => ({
        active: {
          slot: 'LOCAL',
          url: settings.localUrl,
          latencyMs: 8,
          deploymentId: DEPLOYMENT_A,
        },
        probes: [],
      })),
    };
    const service = new DesktopConnectionService(store, resolver);
    await service.initialize();
    const snapshot = await service.save({
      mode: 'AUTO',
      localUrl: 'http://localhost:8180',
      deploymentId: DEPLOYMENT_B,
      activeSlot: 'PUBLIC',
    });

    expect(snapshot.settings.deploymentId).toBe(DEPLOYMENT_A);
    expect(snapshot.settings.activeSlot).toBe('LOCAL');
  });

  it('requires an explicit reset before adopting a different deployment', async () => {
    const store = memoryStore({
      ...DEFAULT_CONNECTION_SETTINGS,
      deploymentId: DEPLOYMENT_A,
      activeSlot: 'LOCAL',
    });
    const resolver = {
      resolve: vi
        .fn()
        .mockResolvedValueOnce({ active: null, probes: [] })
        .mockResolvedValueOnce({
          active: {
            slot: 'PUBLIC',
            url: 'https://new.example.com',
            latencyMs: 20,
            deploymentId: DEPLOYMENT_B,
          },
          probes: [],
        }),
    };
    const service = new DesktopConnectionService(store, resolver);
    await service.initialize();
    const snapshot = await service.resetDeploymentBinding();
    expect(snapshot.settings).toMatchObject({ deploymentId: DEPLOYMENT_B, activeSlot: 'PUBLIC' });
  });
});

function memoryStore(initial = { ...DEFAULT_CONNECTION_SETTINGS }) {
  let current = initial;
  return {
    load: vi.fn(async () => current),
    save: vi.fn(async (input) => {
      current = input;
      return current;
    }),
  };
}
