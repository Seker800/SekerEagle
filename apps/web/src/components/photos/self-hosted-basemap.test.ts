import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map } from 'leaflet';
import { addSelfHostedBasemap } from './self-hosted-basemap';
const mocks = vi.hoisted(() => ({
  create: vi.fn(() => ({})),
  remove: vi.fn(),
  add: vi.fn(),
}));
vi.mock('protomaps-leaflet', () => ({ leafletLayer: mocks.create }));
vi.mock('leaflet', () => ({
  layerGroup: () => ({ addTo: mocks.add.mockReturnValue({ remove: mocks.remove }) }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('self-hosted basemap boundary', () => {
  it('uses only the fixed same-origin archive and preserves world overview outside detail coverage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, headers: new Headers({ 'accept-ranges': 'bytes' }) })),
    );
    const controller = new AbortController();
    await addSelfHostedBasemap({} as Map, controller.signal);
    expect(fetch).toHaveBeenCalledWith(
      '/maps/basemap.pmtiles',
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ maxDataZoom: 7 }));
    expect(mocks.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        maxDataZoom: 14,
        minZoom: 9,
        bounds: [
          [18, 73],
          [54, 136],
        ],
      }),
    );
    for (const [options] of mocks.create.mock.calls as unknown as [{ url: string }][]) {
      expect(new URL(options.url).origin).toBe(window.location.origin);
    }
    controller.abort();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it('keeps the bundled overview when no range-capable archive is installed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, headers: new Headers() })),
    );
    expect(await addSelfHostedBasemap({} as Map, new AbortController().signal)).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
