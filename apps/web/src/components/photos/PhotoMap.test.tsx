import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { PhotoMap } from './PhotoMap';
import type { EagleAssetListItem } from '../../lib/eagle-api';
const mocks = vi.hoisted(() => {
  const map = {
    setView: vi.fn().mockReturnThis(),
    fitBounds: vi.fn(),
    remove: vi.fn(),
    createPane: vi.fn(() => ({ style: {} })),
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 5),
    getBounds: vi.fn(() => ({ contains: () => true })),
    latLngToContainerPoint: vi.fn(() => ({ x: 100, y: 100 })),
    attributionControl: { setPrefix: vi.fn(), addAttribution: vi.fn() },
  };
  const popup = vi.fn();
  const marker = {
    addTo: vi.fn().mockReturnThis(),
    bindPopup: popup,
    bindTooltip: vi.fn().mockReturnThis(),
  };
  return {
    map,
    popup,
    marker,
    tiles: vi.fn(),
    circleMarker: vi.fn<(...args: unknown[]) => typeof marker>(() => marker),
  };
});
vi.mock('leaflet', () => ({
  map: () => mocks.map,
  tileLayer: mocks.tiles,
  circleMarker: mocks.circleMarker,
  latLngBounds: () => ({}),
  geoJSON: () => ({ addTo: vi.fn() }),
  layerGroup: () => ({ addTo: vi.fn().mockReturnThis(), clearLayers: vi.fn(), remove: vi.fn() }),
  marker: () => mocks.marker,
  divIcon: vi.fn(),
  canvas: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());
describe('local night map', () => {
  it('loads only packaged same-origin data and keeps photo popup labels as text', async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [], cities: [] }),
    }));
    vi.stubGlobal('fetch', fetch);
    const asset = {
      id: 'photo',
      displayName: '<img src=x onerror=alert(1)>',
      photoMetadata: { latitude: 31.23, longitude: 121.47 },
    } as EagleAssetListItem;
    render(<PhotoMap assets={[asset]} onOpen={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      fetch.mock.calls.every(
        ([url]) => new URL(String(url), window.location.href).origin === window.location.origin,
      ),
    ).toBe(true);
    expect(mocks.tiles).not.toHaveBeenCalled();
    const label = mocks.popup.mock.calls.at(-1)?.[0] as HTMLElement;
    expect(label.textContent).toBe(asset.displayName);
    expect(label.querySelector('img')).toBeNull();
    expect(mocks.circleMarker.mock.calls.at(-1)?.[1]).toMatchObject({ color: '#d69b48' });
    expect(screen.getByText('离线概览 · 不含街道级细节')).toBeInTheDocument();
  });
});

it('retries local resource failures and keeps the latest photo-open callback without recreating the map', async () => {
  const fetch = vi
    .fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()
    .mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetch);
  const asset = {
    id: 'photo',
    displayName: '照片',
    photoMetadata: { latitude: 0, longitude: 0 },
  } as EagleAssetListItem;
  const onOpen = vi.fn(),
    latest = vi.fn();
  const view = render(<PhotoMap assets={[asset]} onOpen={onOpen} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('本地地图加载失败。');
  view.rerender(<PhotoMap assets={[asset]} onOpen={latest} />);
  (mocks.popup.mock.calls.at(-1)?.[0] as HTMLButtonElement).click();
  expect(latest).toHaveBeenCalledWith(asset);
  expect(onOpen).not.toHaveBeenCalled();
  expect(mocks.map.remove).not.toHaveBeenCalled();
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ type: 'FeatureCollection', features: [], cities: [] }),
  });
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(mocks.map.remove).toHaveBeenCalledTimes(1);
});
