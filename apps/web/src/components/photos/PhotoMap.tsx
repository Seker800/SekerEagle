import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getLocale, t } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { loadLocalBasemap, selectCityLabels } from './local-basemap';
import styles from './PhotoMap.module.css';

export function PhotoMap({
  assets,
  onOpen,
}: {
  assets: EagleAssetListItem[];
  onOpen: (asset: EagleAssetListItem) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    mapRef = useRef<L.Map | null>(null);
  const onOpenRef = useRef(onOpen),
    framed = useRef(false);
  const [status, setStatus] = useState<'LOADING' | 'READY' | 'ERROR'>('LOADING');
  const [reload, setReload] = useState(0);
  const points = useMemo(
    () =>
      assets.flatMap((asset) => {
        const raw = asset.photoMetadata?.latitude != null && asset.photoMetadata?.longitude != null;
        const supplemental =
          asset.photoLocation?.assetRevision === asset.mediaRevision ? asset.photoLocation : null;
        const latitude = raw ? asset.photoMetadata?.latitude : supplemental?.latitude,
          longitude = raw ? asset.photoMetadata?.longitude : supplemental?.longitude;
        return typeof latitude === 'number' &&
          Number.isFinite(latitude) &&
          Math.abs(latitude) <= 90 &&
          typeof longitude === 'number' &&
          Number.isFinite(longitude) &&
          Math.abs(longitude) <= 180
          ? [{ asset, cityLevel: !raw, coordinate: [latitude, longitude] as L.LatLngTuple }]
          : [];
      }),
    [assets],
  );
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
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
    for (const { asset, coordinate, cityLevel } of points) {
      const label = document.createElement('button');
      label.type = 'button';
      label.className = styles.photoLink;
      label.textContent = cityLevel
        ? `${asset.displayName} · ${asset.photoLocation?.name} · ${t('城市级位置，非拍摄坐标')}`
        : asset.displayName;
      label.onclick = () => onOpenRef.current(asset);
      L.circleMarker(coordinate, {
        pane: 'photoLocations',
        radius: 8,
        color: accent,
        weight: 2,
        fillColor: accent,
        fillOpacity: cityLevel ? 0.15 : 0.85,
        ...(cityLevel ? { dashArray: '4 4', radius: 12 } : {}),
      })
        .addTo(markers)
        .bindPopup(label);
    }
    if (points.length && !framed.current) {
      map.fitBounds(L.latLngBounds(points.map((point) => point.coordinate)), {
        maxZoom: 6,
        padding: [48, 48],
      });
      framed.current = true;
    }
    return () => {
      markers.remove();
    };
  }, [points, reload]);
  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <p>{t('已加载 {{value1}} 张带位置照片', { value1: points.length })}</p>
        <button
          type="button"
          disabled={!points.length}
          onClick={() =>
            mapRef.current?.fitBounds(L.latLngBounds(points.map((point) => point.coordinate)), {
              maxZoom: 6,
              padding: [48, 48],
            })
          }
        >
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
      {!points.length && <p>{t('当前照片没有 GPS 信息。')}</p>}
    </section>
  );
}
