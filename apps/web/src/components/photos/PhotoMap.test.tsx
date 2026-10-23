import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { PhotoMap } from './PhotoMap';
import type { EagleAssetListItem } from '../../lib/eagle-api';
const mocks = vi.hoisted(() => {
  const map = {
    setView: vi.fn().mockReturnThis(),
    fitBounds: vi.fn(),
    remove: vi.fn(),
    invalidateSize: vi.fn(),
    createPane: vi.fn(() => ({ style: {} })),
    on: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 5),
    getBounds: vi.fn(() => ({
      contains: () => true,
      getWest: () => 120,
      getEast: () => 122,
      getSouth: () => 30,
      getNorth: () => 32,
    })),
    latLngToContainerPoint: vi.fn(() => ({ x: 100, y: 100 })),
    attributionControl: { setPrefix: vi.fn(), addAttribution: vi.fn() },
  };
  return { map, icons: vi.fn(), tiles: vi.fn(), getMap: vi.fn(), getPhotos: vi.fn() };
});
vi.mock('../../lib/photo-management-api', () => ({
  getPhotoMap: mocks.getMap,
  getPhotoMapPhotos: mocks.getPhotos,
}));
vi.mock('../eagle/EagleAssetThumbnail', () => ({
  EagleAssetThumbnail: () => <span>shared thumbnail</span>,
}));
vi.mock('leaflet', () => ({
  map: () => mocks.map,
  tileLayer: mocks.tiles,
  geoJSON: () => ({ addTo: vi.fn() }),
  layerGroup: () => ({ addTo: vi.fn().mockReturnThis(), clearLayers: vi.fn(), remove: vi.fn() }),
  marker: () => ({ addTo: vi.fn().mockReturnThis() }),
  divIcon: mocks.icons,
}));
const first = { id: '5/20/12', latitude: 31, longitude: 121, count: 10000 };
const asset = {
  id: 'photo',
  displayName: '<img src=x onerror=alert(1)>',
  mediaRevision: 1,
  renditions: [],
} as unknown as EagleAssetListItem;
function mount(onOpen = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const renderMap = (privateVisible = false, callback = onOpen) => (
    <QueryClientProvider client={client}>
      <PhotoMap
        key={String(privateVisible)}
        ownerId="owner"
        includePrivate={privateVisible}
        onOpen={callback}
      />
    </QueryClientProvider>
  );
  const view = render(renderMap());
  return { ...view, client, renderMap, onOpen };
}
function markerButtons() {
  return mocks.icons.mock.calls
    .map(([options]) => (options as { html: HTMLElement }).html)
    .filter((html) => html instanceof HTMLButtonElement) as HTMLButtonElement[];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.map.getZoom.mockReturnValue(5);
  mocks.getMap.mockResolvedValue({
    total: 10001,
    bounds: { west: 120, east: 122, south: 30, north: 32 },
    level: 5,
    clusters: [first, { ...first, id: '5/21/12', longitude: 122, count: 1 }],
  });
  mocks.getPhotos.mockResolvedValue({ items: [asset], nextCursor: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [], cities: [] }),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('whole-library location map', () => {
  it('shows all-library counts without depending on loaded asset pages, scales circles and uses no external tiles', async () => {
    mount();
    expect(await screen.findByText('全库 10001 张带位置照片')).toBeInTheDocument();
    expect(screen.queryByText('载入更多照片')).not.toBeInTheDocument();
    expect(markerButtons()).toHaveLength(2);
    expect(parseFloat(markerButtons()[0]!.style.width)).toBeGreaterThan(
      parseFloat(markerButtons()[1]!.style.width),
    );
    expect(parseFloat(markerButtons()[1]!.style.width)).toBeGreaterThanOrEqual(44);
    expect(mocks.tiles).not.toHaveBeenCalled();
    expect(
      (vi.mocked(fetch).mock.calls as unknown[][]).every(
        ([url]) => new URL(String(url), window.location.href).origin === window.location.origin,
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '显示全部照片位置' }));
    expect(mocks.map.fitBounds).toHaveBeenCalledTimes(2);
  });
  it('opens every group through bounded member pages and the shared viewer callback, treating names as text', async () => {
    const view = mount();
    await waitFor(() => expect(markerButtons()).toHaveLength(2));
    act(() => markerButtons()[0]!.click());
    const photo = await screen.findByRole('button', { name: asset.displayName });
    expect(photo.querySelector('img')).toBeNull();
    const latest = vi.fn();
    view.rerender(view.renderMap(false, latest));
    fireEvent.click(photo);
    expect(latest).toHaveBeenCalledWith(asset, [asset]);
    expect(view.onOpen).not.toHaveBeenCalled();
    expect(mocks.getPhotos).toHaveBeenCalledWith(first.id, undefined, expect.any(AbortSignal));
    expect(mocks.map.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('region', { name: '此位置的照片' })).not.toBeInTheDocument();
  });
  it('queries the new zoom and viewport after moving and retains the selected group membership', async () => {
    mount();
    await waitFor(() => expect(markerButtons()).toHaveLength(2));
    act(() => markerButtons()[0]!.click());
    await screen.findByRole('button', { name: asset.displayName });
    mocks.map.getZoom.mockReturnValue(10);
    const move = mocks.map.on.mock.calls.find(([events]) => events === 'moveend')![1] as () => void;
    act(move);
    await waitFor(() =>
      expect(mocks.getMap).toHaveBeenLastCalledWith(
        { west: 120, east: 122, south: 30, north: 32, zoom: 10 },
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByRole('button', { name: asset.displayName })).toBeInTheDocument();
  });
  it('isolates private cache keys and removes open members on privacy scope changes', async () => {
    const view = mount();
    await waitFor(() => expect(markerButtons()).toHaveLength(2));
    act(() => markerButtons()[0]!.click());
    await screen.findByRole('button', { name: asset.displayName });
    view.rerender(view.renderMap(true));
    await waitFor(() => expect(mocks.getMap).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: asset.displayName })).not.toBeInTheDocument();
    expect(
      view.client.getQueryCache().findAll({ queryKey: ['eagle', 'owner', 'PHOTO', 'map'] }),
    ).toHaveLength(2);
  });
  it('paginates within a selected location rather than limiting the map index', async () => {
    mocks.getPhotos.mockImplementation(async (_cell, after) => ({
      items: [asset],
      nextCursor: after ? null : 'next',
    }));
    mount();
    await waitFor(() => expect(markerButtons()).toHaveLength(2));
    act(() => markerButtons()[0]!.click());
    await screen.findByRole('button', { name: asset.displayName });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(mocks.getPhotos).toHaveBeenLastCalledWith(first.id, 'next', expect.any(AbortSignal)),
    );
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
  });
  it('reports and retries map index and local basemap failures independently', async () => {
    mocks.getMap.mockRejectedValueOnce(new Error('index unavailable'));
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('照片位置加载失败。');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('全库 10001 张带位置照片')).toBeInTheDocument();
  });
  it('retries local basemap failures without losing the all-library index', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('本地地图加载失败。');
    expect(await screen.findByText('全库 10001 张带位置照片')).toBeInTheDocument();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [], cities: [] }),
    } as Response);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mocks.map.remove).toHaveBeenCalledTimes(1);
  });
  it('shows an empty state and disables fitting when the whole library has no valid positions', async () => {
    mocks.getMap.mockResolvedValue({ total: 0, bounds: null, level: 5, clusters: [] });
    mount();
    expect(await screen.findByText('当前照片没有 GPS 信息。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示全部照片位置' })).toBeDisabled();
    expect(markerButtons()).toHaveLength(0);
  });
  it('retries member failures and handles groups whose photos have since become invisible', async () => {
    mocks.getPhotos
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue({ items: [], nextCursor: null });
    mount();
    await waitFor(() => expect(markerButtons()).toHaveLength(2));
    act(() => markerButtons()[0]!.click());
    expect(await screen.findByRole('alert')).toHaveTextContent('位置照片加载失败。');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('此位置暂无可见照片。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });
});
