import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getLocale, t } from '../../i18n';
import { useQuery } from '@tanstack/react-query';
import {
  getPhotoMap,
  type PhotoMapCluster,
  type PhotoMapViewport,
} from '../../lib/photo-management-api';
import { PhotoMapPhotos } from './PhotoMapPhotos';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { describeClusterPlace } from './photo-map-place';
import { loadLocalBasemap, selectCityLabels, type MapCity } from './local-basemap';
import styles from './PhotoMap.module.css';

function clusterPlaceName(cluster: PhotoMapCluster, cities: readonly MapCity[]) {
  const place = describeClusterPlace(cluster, cities);
  if (!place.city)
    return { label: place.regional ? t('多地合并区域') : t('附近区域'), shortLabel: t('附近区域') };
  const city = getLocale() === 'zh-CN' ? place.city.nameZh : place.city.name;
  return {
    label: place.regional
      ? t('{{value1}}周边 · 多地合并', { value1: city })
      : t('{{value1}}附近', { value1: city }),
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
  const [status, setStatus] = useState<'LOADING' | 'READY' | 'ERROR'>('LOADING');
  const [reload, setReload] = useState(0);
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
  });
  const points = locations.data?.clusters;
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
        { maxZoom: 7, padding: [48, 48] },
      );
  };

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, {
      minZoom: 1,
      maxZoom: 12,
      maxBounds: [
        [-85, -180],
        [85, 180],
      ],
      maxBoundsViscosity: 1,
      preferCanvas: true,
    }).setView([30, 105], 3);
    mapRef.current = map;
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
          zoom: Math.round(map.getZoom()),
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
    map.attributionControl.addAttribution(
      '<a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">Natural Earth</a>',
    );
    const citiesPane = map.createPane('photoCities');
    citiesPane.style.pointerEvents = 'none';
    citiesPane.style.zIndex = '450';
    map.createPane('photoLocations').style.zIndex = '600';
    const labels = L.layerGroup().addTo(map),
      controller = new AbortController();
    const palette = getComputedStyle(container.current);
    const accent = palette.getPropertyValue('--eagle-accent').trim() || '#d69b48';
    const land = palette.getPropertyValue('--eagle-panel-raised').trim() || '#1d1f23';
    setStatus('LOADING');
    let updateLabels: (() => void) | undefined;
    void loadLocalBasemap(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.cities.length) setCities(data.cities);
        L.geoJSON(data.land, {
          interactive: false,
          style: { color: accent, weight: 0.7, opacity: 0.25, fillColor: land, fillOpacity: 1 },
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
    const map = mapRef.current;
    if (!map) return;
    const markers = L.layerGroup().addTo(map);
    const accent = container.current
      ? getComputedStyle(container.current).getPropertyValue('--eagle-accent').trim() || '#d69b48'
      : '#d69b48';
    const largest = Math.max(100, ...(points ?? []).map((cluster) => cluster.count));
    for (const cluster of points ?? []) {
      const diameter = 44 + 20 * Math.sqrt(cluster.count / largest);
      const label = document.createElement('button');
      label.type = 'button';
      label.className = styles.cluster;
      label.style.width = `${diameter}px`;
      label.style.height = `${diameter}px`;
      label.style.borderColor = accent;
      const count = document.createElement('span');
      count.textContent = cluster.count.toLocaleString();
      const place = document.createElement('span');
      place.className = styles.clusterPlace;
      const placeInfo = placeNames.get(cluster.id) ?? {
        label: t('附近区域'),
        shortLabel: t('附近区域'),
      };
      place.textContent = placeInfo.shortLabel;
      label.append(count, place);
      label.title = placeInfo.label;
      label.setAttribute(
        'aria-label',
        t('查看{{value1}}的 {{value2}} 张照片', {
          value1: placeInfo.label,
          value2: cluster.count,
        }),
      );
      label.onclick = () => setSelected(cluster);
      L.marker([cluster.latitude, cluster.longitude], {
        pane: 'photoLocations',
        keyboard: false,
        icon: L.divIcon({
          className: styles.clusterIcon,
          html: label,
          iconSize: [diameter, diameter],
          iconAnchor: [diameter / 2, diameter / 2],
        }),
      }).addTo(markers);
    }
    return () => {
      markers.remove();
    };
  }, [points, placeNames, reload]);
  useEffect(() => {
    if (bounds && !framed.current && mapRef.current) {
      mapRef.current.fitBounds(
        [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ],
        { maxZoom: 7, padding: [48, 48] },
      );
      framed.current = true;
    }
  }, [bounds, reload]);
  return (
    <section className={styles.panel}>
      <div className={styles.mapLayout} data-selected={Boolean(selected)}>
        <div className={styles.mapArea}>
          <div className={styles.heading}>
            <p>{t('全库 {{value1}} 张带位置照片', { value1: locations.data?.total ?? '—' })}</p>
            <button type="button" disabled={!bounds} onClick={showAll}>
              {t('显示全部照片位置')}
            </button>
          </div>
          <div className={styles.frame} ref={container} aria-label={t('照片地图')} />
          <div className={styles.caption}>
            <span>{t('离线概览 · 不含街道级细节')}</span>
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
          {locations.isPending && <p role="status">{t('正在统计照片位置…')}</p>}
          {locations.isError && (
            <p role="alert">
              {t('照片位置加载失败。')}{' '}
              <button type="button" onClick={() => void locations.refetch()}>
                {t('重试')}
              </button>
            </p>
          )}
          {locations.data?.total === 0 && <p>{t('当前照片没有 GPS 信息。')}</p>}
          <p className={styles.hint}>
            {t('圆圈大小表示照片数量；放大查看附近位置，点击浏览该组全部照片。')}
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
          />
        )}
      </div>
    </section>
  );
}
