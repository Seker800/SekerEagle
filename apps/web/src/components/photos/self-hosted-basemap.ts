import { layerGroup, type GridLayer, type Map } from 'leaflet';
import { getLocale } from '../../i18n';

/** A fixed same-origin archive. No viewport coordinates or photo metadata leave the host. */
export async function addSelfHostedBasemap(map: Map, signal: AbortSignal) {
  const response = await fetch('/maps/basemap.pmtiles', {
    method: 'HEAD',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok || response.headers.get('accept-ranges') !== 'bytes') return null;
  const { leafletLayer } = await import('protomaps-leaflet');
  if (signal.aborted) return null;
  const options = {
    url: new URL('/maps/basemap.pmtiles', window.location.origin).href,
    flavor: 'dark',
    lang: getLocale() === 'zh-CN' ? 'zh' : 'en',
    noWrap: true,
  };
  // A world overview remains visible when panning outside the downloaded detail region.
  const overview = leafletLayer({ ...options, maxDataZoom: 7 }) as unknown as GridLayer;
  const detail = leafletLayer({
    ...options,
    attribution: '',
    maxDataZoom: 14,
    minZoom: 9,
    bounds: [
      [18, 73],
      [54, 136],
    ],
  }) as unknown as GridLayer;
  const layer = layerGroup([overview, detail]).addTo(map);
  signal.addEventListener('abort', () => layer.remove(), { once: true });
  return layer;
}
