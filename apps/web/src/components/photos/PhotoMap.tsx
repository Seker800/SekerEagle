import { useEffect, useMemo, useRef, useState } from 'react';
import { IconFocusCentered, IconMapPin } from '@tabler/icons-react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getLocale, t } from '../../i18n';
import { useQuery } from '@tanstack/react-query';
import {
  getPhotoMap,
  type PhotoMapCluster,
  type PhotoMapViewport,
} from '../../lib/photo-management-api';
import { PhotoMapMarkers } from './PhotoMapMarkers';
import { PhotoMapPhotos } from './PhotoMapPhotos';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { describeClusterPlace } from './photo-map-place';
import { loadLocalBasemap, selectCityLabels, type MapCity } from './local-basemap';
import { addSelfHostedBasemap } from './self-hosted-basemap';
import styles from './PhotoMap.module.css';

function clusterPlaceName(cluster: PhotoMapCluster, cities: readonly MapCity[]) {
  const place = describeClusterPlace(cluster, cities);
  if (!place.city)
    return {
      label: place.regional ? t('多地合并区域') : t('附近区域'),
      shortLabel: t('附近区域'),
      regional: place.regional,
    };
  const city = getLocale() === 'zh-CN' ? place.city.nameZh : place.city.name;
  return {
    label: place.regional
      ? t('{{value1}}周边 · 多地合并', { value1: city })
      : t('{{value1}}附近', { value1: city }),
    regional: place.regional,
    shortLabel: place.regional ? t('{{value1}}等', { value1: city }) : city,
  };
}

export function PhotoMap({
  ownerId,
  includePrivate,
  onOpen,
}: {
  ownerId: string | null;
  includePrivate: boolean;
  onOpen: (asset: EagleAssetListItem, context?: EagleAssetListItem[]) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    mapRef = useRef<L.Map | null>(null);
  const framed = useRef(false);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [status, setStatus] = useState<'LOADING' | 'READY' | 'ERROR'>('LOADING');
  const [reload, setReload] = useState(0);
  const [hasDetailedMap, setHasDetailedMap] = useState(false);
  const [cities, setCities] = useState<readonly MapCity[]>([]);
  const [viewport, setViewport] = useState<PhotoMapViewport>({
    west: -180,
    east: 180,
    south: -90,
    north: 90,
    zoom: 3,
  });
  const [selected, setSelected] = useState<PhotoMapCluster | null>(null);
  const locations = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'map', includePrivate, viewport],
    queryFn: ({ signal }) => getPhotoMap(viewport, signal),
    staleTime: 30000,
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (
      selected &&
      (locations.data?.status === 'PENDING' ||
        (locations.data?.snapshotId && !selected.id.startsWith(`${locations.data.snapshotId}:`)))
    )
      setSelected(null);
  }, [locations.data?.status, locations.data?.snapshotId, selected]);
  const points = useMemo(() => locations.data?.clusters ?? [], [locations.data?.clusters]);
  const bounds = locations.data?.bounds;
  const placeNames = useMemo(
    () => new Map((points ?? []).map((cluster) => [cluster.id, clusterPlaceName(cluster, cities)])),
    [points, cities],
  );
  const selectedPlace = useMemo(
    () => (selected ? clusterPlaceName(selected, cities).label : ''),
    [selected, cities],
  );
  const showAll = () => {
    if (bounds)
      mapRef.current?.fitBounds(
        [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ],
        { maxZoom: 7, padding: [96, 80] },
      );
  };

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, {
      minZoom: 1,
      maxZoom: 16,
      maxBounds: [
        [-85, -180],
        [85, 180],
      ],
      maxBoundsViscosity: 1,
      preferCanvas: true,
    }).setView([30, 105], 3);
    mapRef.current = map;
    setMapInstance(map);
    framed.current = false;
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    const updateViewport = () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        const current = map.getBounds();
        setViewport({
          west: Math.max(-180, current.getWest()),
          east: Math.min(180, current.getEast()),
          south: Math.max(-90, current.getSouth()),
          north: Math.min(90, current.getNorth()),
          zoom: Math.min(16, Math.round(map.getZoom())),
        });
      }, 180);
    };
    map.on('moveend', updateViewport);
    const resize =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => map.invalidateSize({ animate: false }))
        : null;
    resize?.observe(container.current);
    map.attributionControl.setPrefix(false);
    const citiesPane = map.createPane('photoCities');
    citiesPane.style.pointerEvents = 'none';
    citiesPane.style.zIndex = '450';
    map.createPane('photoLocations').style.zIndex = '600';
    map.createPane('photoDistribution').style.zIndex = '550';
    const labels = L.layerGroup().addTo(map),
      controller = new AbortController();
    const palette = getComputedStyle(container.current);
    const land = palette.getPropertyValue('--map-land').trim() || '#25272d';
    setStatus('LOADING');
    let updateLabels: (() => void) | undefined;
    void loadLocalBasemap(controller.signal)
      .then(async (data) => {
        if (controller.signal.aborted) return;
        if (data.cities.length) setCities(data.cities);
        const vectorLayer = await addSelfHostedBasemap(map, controller.signal);
        if (controller.signal.aborted) return;
        setHasDetailedMap(Boolean(vectorLayer));
        if (vectorLayer) {
          setStatus('READY');
          return;
        }
        map.attributionControl.addAttribution(
          '<a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">Natural Earth</a>',
        );
        L.geoJSON(data.land, {
          interactive: false,
          style: { color: '#363b43', weight: 0.8, opacity: 1, fillColor: land, fillOpacity: 1 },
        }).addTo(map);
        updateLabels = () => {
          labels.clearLayers();
          const visible = selectCityLabels(
            data.cities,
            map.getZoom(),
            (city) => map.getBounds().contains([city.latitude, city.longitude]),
            (city) => map.latLngToContainerPoint([city.latitude, city.longitude]),
          );
          for (const city of visible) {
            const label = document.createElement('span');
            label.className = styles.city;
            label.textContent = getLocale() === 'zh-CN' ? city.nameZh : city.name;
            L.marker([city.latitude, city.longitude], {
              pane: 'photoCities',
              interactive: false,
              keyboard: false,
              icon: L.divIcon({ className: styles.cityIcon, html: label, iconSize: [0, 0] }),
            }).addTo(labels);
          }
        };
        map.on('moveend zoomend', updateLabels);
        updateLabels();
        setStatus('READY');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('ERROR');
      });
    return () => {
      clearTimeout(moveTimer);
      map.off('moveend', updateViewport);
      controller.abort();
      resize?.disconnect();
      if (updateLabels) map.off('moveend zoomend', updateLabels);
      map.remove();
      mapRef.current = null;
    };
  }, [reload]);
  useEffect(() => {
    if (bounds && !framed.current && mapRef.current) {
      mapRef.current.fitBounds(
        [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ],
        { maxZoom: 7, padding: [96, 80] },
      );
      framed.current = true;
    }
  }, [bounds, reload]);
  return (
    <section className={styles.panel}>
      <div className={styles.mapLayout} data-selected={Boolean(selected)}>
        <div className={styles.mapArea}>
          <div className={styles.heading}>
            <div className={styles.mapSummary}>
              <IconMapPin size={18} aria-hidden="true" />
              <div>
                <p>
                  {t('全库 {{value1}} 张带位置照片', {
                    value1:
                      locations.data?.status === 'PENDING' ? '—' : (locations.data?.total ?? '—'),
                  })}
                </p>
                <span>
                  {hasDetailedMap
                    ? t('中国及周边详细地图 · 其他地区为全球概览')
                    : t('离线概览 · 详细地图尚未安装')}
                </span>
              </div>
            </div>
            <button type="button" disabled={!bounds} onClick={showAll}>
              <IconFocusCentered size={15} aria-hidden="true" />
              {t('显示全部照片位置')}
            </button>
          </div>
          <div className={styles.frame} ref={container} aria-label={t('照片地图')} />
          <PhotoMapMarkers
            viewport={viewport}
            map={mapInstance}
            clusters={points}
            names={placeNames}
            selectedId={selected?.id}
            onSelect={setSelected}
          />
          <div className={styles.caption}>
            {locations.data?.updatedAt && (
              <span>
                {t('地图更新于 {{value1}}', {
                  value1: new Date(locations.data.updatedAt).toLocaleString(getLocale(), {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </span>
            )}
            <span>
              {hasDetailedMap
                ? t('自托管矢量底图 · 道路与建筑随缩放显示')
                : t('离线概览 · 不含街道级细节')}
            </span>
            {status === 'LOADING' && <span role="status">{t('正在加载本地地图…')}</span>}
            {status === 'ERROR' && (
              <span role="alert">
                {t('本地地图加载失败。')}{' '}
                <button type="button" onClick={() => setReload((value) => value + 1)}>
                  {t('重试')}
                </button>
              </span>
            )}
          </div>
          {locations.isPending && <p role="status">{t('正在读取地图索引…')}</p>}
          {locations.isError && (
            <p role="alert">
              {t('照片位置加载失败。')}{' '}
              <button type="button" onClick={() => void locations.refetch()}>
                {t('重试')}
              </button>
            </p>
          )}
          {locations.data?.status === 'PENDING' && (
            <p role="status">{t('地图正在后台整理，完成后会自动显示。')}</p>
          )}
          {locations.data?.status === 'UPDATING' && (
            <p>{t('正在后台更新地图，当前显示上次整理结果。')}</p>
          )}
          {locations.data?.total === 0 && locations.data?.status !== 'PENDING' && (
            <p>{t('当前照片没有 GPS 信息。')}</p>
          )}
          <p className={styles.hint}>
            {t('小点表示拍摄足迹；当前视野拍摄量最多的 9 个地点显示照片。')}
          </p>
        </div>
        {selected && (
          <PhotoMapPhotos
            key={selected.id}
            cluster={selected}
            placeName={selectedPlace}
            ownerId={ownerId}
            includePrivate={includePrivate}
            onOpen={onOpen}
            onClose={() => setSelected(null)}
            onZoom={() => {
              const map = mapRef.current;
              if (!map) return;
              if (
                selected.south != null &&
                selected.north != null &&
                selected.west != null &&
                selected.east != null &&
                (selected.south !== selected.north || selected.west !== selected.east)
              )
                map.fitBounds(
                  [
                    [selected.south, selected.west],
                    [selected.north, selected.east],
                  ],
                  { maxZoom: 16, padding: [48, 48] },
                );
              else
                map.setView(
                  [
                    selected.photoLatitude ?? selected.latitude,
                    selected.photoLongitude ?? selected.longitude,
                  ],
                  Math.min(16, map.getZoom() + 2),
                );
            }}
          />
        )}
      </div>
    </section>
  );
}
