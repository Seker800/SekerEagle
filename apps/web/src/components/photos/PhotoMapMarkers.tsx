import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as L from 'leaflet';
import { getLocale, t } from '../../i18n';
import type { PhotoMapCluster } from '../../lib/photo-management-api';
import { EagleAssetThumbnail } from '../eagle/EagleAssetThumbnail';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import {
  layoutPhotoMapMarkers,
  photoMapPosition,
  type PhotoMapMarkerPlan,
} from './photo-map-markers';
import styles from './PhotoMap.module.css';

interface MarkerMount {
  group: PhotoMapMarkerPlan;
  button: HTMLButtonElement;
  content: HTMLElement;
  marker: L.Marker;
}
export function PhotoMapMarkers({
  map,
  clusters,
  names,
  selectedId,
  onSelect,
  viewport,
}: {
  map: L.Map | null;
  viewport: object;
  clusters: readonly PhotoMapCluster[];
  names: ReadonlyMap<string, { label: string; shortLabel: string; regional?: boolean }>;
  selectedId?: string;
  onSelect: (cluster: PhotoMapCluster) => void;
}) {
  const [mounts, setMounts] = useState<MarkerMount[]>([]);
  const activeMounts = useRef<MarkerMount[]>([]);
  const activeDots = useRef<Array<{ id: string; point: L.CircleMarker; radius: number }>>([]);
  const focusedKey = useRef<string | null>(null);
  const scheduler = useMemo(() => new MediaLoadScheduler(), []);
  const loadService = useMemo(() => new ThumbnailLoadService(), []);
  useEffect(
    () => () => {
      scheduler.clear({ abortActive: true });
      loadService.dispose();
    },
    [scheduler, loadService],
  );
  useEffect(() => {
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    const groups = layoutPhotoMapMarkers(clusters);
    const renderer = L.canvas({ pane: 'photoDistribution', padding: 0.1, tolerance: 4 });
    activeDots.current = groups.map((group) => {
      const label = document.createElement('span');
      label.textContent = t('查看{{value1}}的 {{value2}} 张照片', {
        value1: names.get(group.cluster.id)?.label ?? t('附近区域'),
        value2: group.cluster.count,
      });
      const radius = Math.min(2, 0.9 + Math.log10(group.cluster.count + 1) * 0.25);
      const point = L.circleMarker(photoMapPosition(group.cluster), {
        pane: 'photoDistribution',
        renderer,
        radius,
        color: '#c4d5e5',
        weight: 0.4,
        fillColor: '#8eaac3',
        fillOpacity: 0.65,
        opacity: 1,
      }).addTo(layer);
      point.bindTooltip(label, { direction: 'top', offset: [0, -5] });
      point.on('click', () => onSelect(group.cluster));
      return { id: group.cluster.id, point, radius };
    });
    const next = groups
      .filter((group) => group.presentation === 'photo')
      .map((group): MarkerMount => {
        const place = names.get(group.cluster.id) ?? {
          label: t('附近区域'),
          shortLabel: t('附近区域'),
        };
        const button = document.createElement('button');
        button.type = 'button';
        button.className = styles.cluster;
        button.dataset.stacked = String(group.cluster.count > 1);
        button.title = place.label;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute(
          'aria-label',
          t('查看{{value1}}的 {{value2}} 张照片', {
            value1: place.label,
            value2: group.cluster.count,
          }),
        );
        const content = document.createElement('span');
        content.className = styles.clusterPhoto;
        content.setAttribute('aria-hidden', 'true');
        const count = document.createElement('span');
        count.className = styles.clusterCount;
        count.textContent = group.cluster.count.toLocaleString(getLocale());
        const name = document.createElement('span');
        name.className = styles.clusterPlace;
        name.textContent = place.shortLabel;
        button.append(content, count, name);
        const marker = L.marker(photoMapPosition(group.cluster), {
          pane: 'photoLocations',
          keyboard: false,
          icon: L.divIcon({
            className: styles.clusterIcon,
            html: button,
            iconSize: [40, 48],
            iconAnchor: [20, 44],
          }),
        }).addTo(layer);
        button.onclick = () => onSelect(group.cluster);
        const raise = () => marker.setZIndexOffset(1500);
        const restore = () =>
          marker.setZIndexOffset(button.getAttribute('aria-pressed') === 'true' ? 1000 : 0);
        button.onpointerenter = raise;
        button.onpointerleave = restore;
        button.onfocus = raise;
        button.onblur = restore;
        return { group, button, content, marker };
      });
    activeMounts.current = next;
    next
      .find(({ group }) => group.key === focusedKey.current)
      ?.button.focus({ preventScroll: true });
    setMounts(next);
    return () => {
      focusedKey.current =
        next.find(({ button }) => button === document.activeElement)?.group.key ?? null;
      activeMounts.current = [];
      activeDots.current = [];
      layer.remove();
      renderer.remove();
    };
  }, [map, clusters, names, onSelect, viewport]);
  useEffect(() => {
    for (const { id, point, radius } of activeDots.current) {
      const active = id === selectedId;
      point.setRadius(active ? radius + 1.5 : radius);
      point.setStyle({
        fillColor: active ? '#d6eaff' : '#8eaac3',
        color: active ? '#ffffff' : '#c4d5e5',
      });
    }
    for (const { group, button, marker } of activeMounts.current) {
      const active = group.cluster.id === selectedId;
      button.setAttribute('aria-pressed', String(active));
      marker.setZIndexOffset(active ? 1000 : 0);
    }
  }, [selectedId, mounts]);
  return mounts.map(({ group, content }, index) =>
    createPortal(
      group.cluster.cover ? (
        <EagleAssetThumbnail
          asset={group.cluster.cover}
          scheduler={scheduler}
          loadService={loadService}
          order={index}
          displayWidth={40}
        />
      ) : (
        <span className={styles.coverPending}>{t('封面待生成')}</span>
      ),
      content,
      group.key,
    ),
  );
}
