import type { SekerDesktopBridge } from '../../lib/media-resolver';

export type DesktopAssetDragBridge = Required<Pick<SekerDesktopBridge, 'startAssetDrag'>>;

export function getDesktopAssetDragBridge(): DesktopAssetDragBridge | null {
  const candidate = (globalThis as { sekerDesktop?: Partial<SekerDesktopBridge> }).sekerDesktop;
  return candidate?.version === 1 && typeof candidate.startAssetDrag === 'function'
    ? (candidate as SekerDesktopBridge & DesktopAssetDragBridge)
    : null;
}

export function getAssetDragIds({
  orderedIds,
  selectedIds,
  draggedId,
}: {
  orderedIds: string[];
  selectedIds: string[];
  draggedId: string;
}): string[] {
  if (!selectedIds.includes(draggedId)) return [draggedId];
  const selected = new Set(selectedIds);
  return orderedIds.filter((assetId) => selected.has(assetId));
}
