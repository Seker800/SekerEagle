import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as L from 'leaflet';
import { getLocale, t } from '../../i18n';
import type { PhotoMapCluster } from '../../lib/photo-management-api';
import { EagleAssetThumbnail } from '../eagle/EagleAssetThumbnail';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import {
  groupPhotoMapMarkers,
  photoMapPosition,
  type PhotoMapMarkerGroup,
} from './photo-map-markers';
import styles from './PhotoMap.module.css';

interface MarkerMount {
  group: PhotoMapMarkerGroup;
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
    const groups = groupPhotoMapMarkers(
      clusters,
      (position) => map.latLngToContainerPoint(position),
      map.getZoom(),
    );
    const next = groups.map((group): MarkerMount => {
      const place = names.get(group.representative.id) ?? {
        label: t('附近区域'),
        shortLabel: t('附近区域'),
      };
      const shouldZoom = group.members.length > 1 || (group.count > 1 && place.regional);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = styles.cluster;
      button.dataset.stacked = String(group.count > 1);
      button.title = place.label;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute(
        'aria-label',
        shouldZoom
          ? t('放大查看 {{value1}} 张照片的位置', { value1: group.count })
          : t('查看{{value1}}的 {{value2}} 张照片', { value1: place.label, value2: group.count }),
      );
      const content = document.createElement('span');
      content.className = styles.clusterPhoto;
      content.setAttribute('aria-hidden', 'true');
      const count = document.createElement('span');
      count.className = styles.clusterCount;
      count.textContent = group.count.toLocaleString(getLocale());
      const name = document.createElement('span');
      name.className = styles.clusterPlace;
      name.textContent = place.shortLabel;
      button.append(content, count, name);
      const marker = L.marker(photoMapPosition(group.representative), {
        pane: 'photoLocations',
        keyboard: false,
        icon: L.divIcon({
          className: styles.clusterIcon,
          html: button,
          iconSize: [52, 64],
          iconAnchor: [26, 60],
        }),
      }).addTo(layer);
      button.onclick = () => {
        if (!shouldZoom || map.getZoom() >= 16) onSelect(group.representative);
        else map.setView(photoMapPosition(group.representative), Math.min(16, map.getZoom() + 2));
      };
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
      layer.remove();
    };
  }, [map, clusters, names, onSelect, viewport]);
  useEffect(() => {
    for (const { group, button, marker } of activeMounts.current) {
      const active = group.members.some((cluster) => cluster.id === selectedId);
      button.setAttribute('aria-pressed', String(active));
      marker.setZIndexOffset(active ? 1000 : 0);
    }
  }, [selectedId, mounts]);
  return mounts.map(({ group, content }, index) =>
    createPortal(
      group.representative.cover ? (
        <EagleAssetThumbnail
          asset={group.representative.cover}
          scheduler={scheduler}
          loadService={loadService}
          order={index}
          displayWidth={52}
        />
      ) : (
        <span className={styles.coverPending}>{t('封面待生成')}</span>
      ),
      content,
      group.key,
    ),
  );
}
