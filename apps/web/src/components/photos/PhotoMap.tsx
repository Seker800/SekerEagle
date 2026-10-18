import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { t } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';

export function PhotoMap({
  assets,
  onOpen,
}: {
  assets: EagleAssetListItem[];
  onOpen: (asset: EagleAssetListItem) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [tileError, setTileError] = useState(false);
  const points = assets.filter(
    (asset) => asset.photoMetadata?.latitude != null && asset.photoMetadata.longitude != null,
  );
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { worldCopyJump: true }).setView([25, 10], 2);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    tiles.on('tileerror', () => setTileError(true));
    const bounds: L.LatLngTuple[] = [];
    for (const asset of assets) {
      const metadata = asset.photoMetadata;
      if (metadata?.latitude == null || metadata.longitude == null) continue;
      const coordinate: L.LatLngTuple = [metadata.latitude, metadata.longitude];
      bounds.push(coordinate);
      const label = document.createElement('button');
      label.type = 'button';
      label.textContent = asset.displayName;
      label.onclick = () => onOpen(asset);
      L.circleMarker(coordinate, { radius: 8, color: '#4f63df', fillOpacity: 0.8 })
        .addTo(map)
        .bindPopup(label);
    }
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { maxZoom: 13, padding: [32, 32] });
    return () => {
      map.remove();
    };
  }, [assets, onOpen]);
  return (
    <section className="photo-map-panel">
      <p>{t('已加载 {{value1}} 张带位置照片', { value1: points.length })}</p>
      {tileError && <p role="status">{t('地图底图暂不可用，照片坐标仍可在详情中查看。')}</p>}
      <div
        ref={container}
        style={{ height: 'min(65vh, 650px)', minHeight: 320 }}
        aria-label={t('照片地图')}
      />
      {!points.length && <p>{t('当前照片没有 GPS 信息。')}</p>}
    </section>
  );
}
