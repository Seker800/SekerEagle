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
    latLngToContainerPoint: vi.fn(([latitude, longitude]) => ({
      x: longitude * 100,
      y: latitude * 100,
    })),
    attributionControl: { setPrefix: vi.fn(), addAttribution: vi.fn() },
  };
  return {
    map,
    icons: vi.fn(),
    dots: vi.fn(),
    tiles: vi.fn(),
    getMap: vi.fn(),
    getPhotos: vi.fn(),
  };
});
vi.mock('../../lib/photo-management-api', () => ({
  getPhotoMap: mocks.getMap,
  getPhotoMapPhotos: mocks.getPhotos,
}));
vi.mock('../eagle/EagleAssetThumbnail', () => ({
  EagleAssetThumbnail: () => <span>shared thumbnail</span>,
}));
vi.mock('./self-hosted-basemap', () => ({ addSelfHostedBasemap: vi.fn(async () => null) }));
vi.mock('leaflet', () => ({
  map: () => mocks.map,
  tileLayer: mocks.tiles,
  geoJSON: () => ({ addTo: vi.fn() }),
  layerGroup: () => ({ addTo: vi.fn().mockReturnThis(), clearLayers: vi.fn(), remove: vi.fn() }),
  canvas: () => ({ remove: vi.fn() }),
  circleMarker: mocks.dots,
  marker: () => ({ addTo: vi.fn().mockReturnThis(), setZIndexOffset: vi.fn() }),
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
  mocks.dots.mockImplementation(() => ({
    addTo: vi.fn().mockReturnThis(),
    bindTooltip: vi.fn(),
    on: vi.fn(),
    setStyle: vi.fn(),
    setRadius: vi.fn(),
  }));
  mocks.getMap.mockResolvedValue({
    total: 10001,
    bounds: { west: 120, east: 122, south: 30, north: 32 },
    level: 5,
    clusters: [
      { ...first, cover: asset },
      { ...first, id: '5/21/12', longitude: 122, count: 1, cover: { ...asset, id: 'second' } },
    ],
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
  it('opens regional locations immediately and zooms only when the user requests it', async () => {
    mocks.getMap.mockResolvedValue({
      total: 10,
      level: 6,
      clusters: [
        {
          ...first,
          count: 10,
          cover: asset,
          photoLatitude: 37.5,
          photoLongitude: 122,
          south: 36,
          north: 38,
          west: 120,
          east: 123,
        },
      ],
    });
    const { onOpen } = mount();
    await screen.findByText('全库 10 张带位置照片');
    await waitFor(() => expect(markerButtons()).toHaveLength(1));
    expect(markerButtons()[0].getAttribute('aria-label')).toContain('10 张照片');
    fireEvent.click(markerButtons()[0]);
    await screen.findByRole('button', { name: '放大此位置' });
    expect(mocks.getPhotos).toHaveBeenCalled();
    expect(mocks.map.setView).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '放大此位置' }));
    expect(mocks.map.fitBounds).toHaveBeenLastCalledWith(
      [
        [36, 120],
        [38, 123],
      ],
      { maxZoom: 16, padding: [48, 48] },
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
  it('keeps all 48 footprints but features only nine location thumbnails', async () => {
    mocks.getMap.mockResolvedValue({
      total: 48,
      level: 12,
      clusters: Array.from({ length: 48 }, (_, i) => ({
        id: `12/${i}/1`,
        count: 1,
        latitude: 30,
        longitude: 120,
        photoLatitude: 30 + Math.floor(i / 8) * 0.6,
        photoLongitude: 120 + (i % 8) * 0.55,
        cover: { ...asset, id: `photo-${i}` },
      })),
    });
    mount();
    await screen.findByText('全库 48 张带位置照片');
    await waitFor(() => expect(markerButtons()).toHaveLength(9));
    expect(mocks.dots).toHaveBeenCalledTimes(48);
    expect(markerButtons().every((button) => button.textContent?.includes('1'))).toBe(true);
  });

  it('shows readable location cards with complete counts and uses no external tiles', async () => {
    mount();
    expect(await screen.findByText('全库 10001 张带位置照片')).toBeInTheDocument();
    expect(screen.queryByText('载入更多照片')).not.toBeInTheDocument();
    expect(markerButtons()).toHaveLength(2);
    expect(markerButtons()[0]).toHaveTextContent('10,000');
    await waitFor(() => expect(markerButtons()[0]).toHaveTextContent('shared thumbnail'));
    expect(markerButtons()[1]).toHaveTextContent('1');
    expect(markerButtons()[0]).toHaveAttribute('aria-pressed', 'false');
    expect(markerButtons()[0]!.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('离线概览 · 详细地图尚未安装')).toBeInTheDocument();
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
    const originalMarkers = markerButtons();
    act(() => originalMarkers[0]!.click());
    expect(originalMarkers[0]).toHaveAttribute('aria-pressed', 'true');
    expect(originalMarkers[1]).toHaveAttribute('aria-pressed', 'false');
    expect(markerButtons()).toEqual(originalMarkers);
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
    expect(originalMarkers[0]).toHaveAttribute('aria-pressed', 'false');
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
  it('labels a Weihai group from photo coordinates even below the basemap city zoom threshold and carries it into the photo panel', async () => {
    const city = {
      name: 'Weihai',
      nameZh: '威海',
      latitude: 37.5,
      longitude: 122.1,
      population: 560255,
      minZoom: 6,
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [], cities: [city] }),
    } as Response);
    mocks.getMap.mockResolvedValue({
      total: 10000,
      bounds: { west: 122, east: 122.2, south: 37.4, north: 37.6 },
      level: 5,
      clusters: [
        {
          ...first,
          cover: asset,
          photoLatitude: 37.5,
          photoLongitude: 122.1,
          west: 122.09,
          east: 122.11,
          south: 37.49,
          north: 37.51,
        },
      ],
    });
    mount();
    await waitFor(() =>
      expect(markerButtons().some((button) => button.title === '威海附近')).toBe(true),
    );
    const marker = markerButtons().find((button) => button.title === '威海附近')!;
    expect(marker.getAttribute('aria-label')).toContain('威海附近');
    act(() => marker.click());
    expect(await screen.findByRole('heading', { name: '威海附近' })).toBeInTheDocument();
    expect(mocks.map.remove).not.toHaveBeenCalled();
  });
});

it('keeps every dense position as an interactive canvas dot when thumbnail cards overlap', async () => {
  const points = Array.from({ length: 120 }, (_, i) => ({
    ...first,
    id: `12/${i}/1`,
    count: 1,
    photoLatitude: 30 + (i % 10) * 0.01,
    photoLongitude: 120 + Math.floor(i / 10) * 0.01,
    cover: { ...asset, id: `photo-${i}` },
  }));
  mocks.getMap.mockResolvedValue({ total: 120, level: 12, clusters: points });
  mount();
  await screen.findByText('全库 120 张带位置照片');
  await waitFor(() => expect(mocks.dots).toHaveBeenCalledTimes(120));
  expect(
    mocks.dots.mock.calls.every(
      ([, options]) =>
        (options as { radius: number; fillColor: string; fillOpacity: number }).radius >= 2.2 &&
        (options as { fillColor: string }).fillColor === '#ffffff' &&
        (options as { fillOpacity: number }).fillOpacity === 1,
    ),
  ).toBe(true);
  expect(markerButtons()).toHaveLength(9);
  const point = mocks.dots.mock.results[70].value as { on: ReturnType<typeof vi.fn> };
  const click = point.on.mock.calls.find(([event]) => event === 'click')![1] as () => void;
  act(click);
  await screen.findByRole('region', { name: '此位置的照片' });
  expect(mocks.getPhotos).toHaveBeenLastCalledWith(
    [...points].sort((a, b) => a.id.localeCompare(b.id))[70].id,
    undefined,
    expect.any(AbortSignal),
  );
});

it('waits for a persisted snapshot without claiming a pending index means no GPS', async () => {
  mocks.getMap.mockResolvedValue({
    status: 'PENDING',
    snapshotId: null,
    total: 0,
    bounds: null,
    level: 7,
    clusters: [],
  });
  const view = mount();
  expect(await screen.findByText('地图正在后台整理，完成后会自动显示。')).toBeInTheDocument();
  expect(screen.queryByText('当前照片没有 GPS 信息。')).not.toBeInTheDocument();
  expect(mocks.getPhotos).not.toHaveBeenCalled();
  mocks.getMap.mockResolvedValue({
    status: 'READY',
    snapshotId: 'snapshot',
    updatedAt: '2026-10-24T00:00:00Z',
    total: 1000,
    bounds: { west: 120, east: 122, south: 30, north: 32 },
    level: 7,
    clusters: [{ ...first, cover: asset }],
  });
  await act(() => view.client.invalidateQueries({ queryKey: ['eagle', 'owner', 'PHOTO', 'map'] }));
  expect(await screen.findByText('全库 1000 张带位置照片')).toBeInTheDocument();
  expect(screen.queryByText('地图正在后台整理，完成后会自动显示。')).not.toBeInTheDocument();
  expect(mocks.getPhotos).not.toHaveBeenCalled();
});
it('labels stale-but-readable snapshots while new photos wait for background batching', async () => {
  mocks.getMap.mockResolvedValue({
    status: 'UPDATING',
    snapshotId: 'snapshot',
    total: 1000,
    level: 7,
    clusters: [{ ...first, cover: asset }],
  });
  mount();
  expect(await screen.findByText('正在后台更新地图，当前显示上次整理结果。')).toBeInTheDocument();
  expect(markerButtons()).toHaveLength(1);
});

it('closes an open location when a sensitive change invalidates its map snapshot', async () => {
  mocks.getMap.mockResolvedValue({
    status: 'READY',
    snapshotId: 'old',
    total: 1000,
    level: 7,
    clusters: [{ ...first, id: 'old:5/20/12', cover: asset }],
  });
  const view = mount();
  await waitFor(() => expect(markerButtons()).toHaveLength(1));
  act(() => markerButtons()[0].click());
  await screen.findByRole('region', { name: '此位置的照片' });
  mocks.getMap.mockResolvedValue({
    status: 'PENDING',
    snapshotId: null,
    total: 0,
    level: 7,
    clusters: [],
  });
  await act(() => view.client.invalidateQueries({ queryKey: ['eagle', 'owner', 'PHOTO', 'map'] }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: '此位置的照片' })).not.toBeInTheDocument(),
  );
});
