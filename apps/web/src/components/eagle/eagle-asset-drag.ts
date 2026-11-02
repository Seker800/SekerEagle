import type { LibraryMode } from '../../lib/library-api-scope';
import type { SekerDesktopBridge } from '../../lib/media-resolver';

export type DesktopAssetDragBridge = Required<
  Pick<SekerDesktopBridge, 'prepareAssetDrag' | 'startPreparedAssetDrag'>
> &
  Pick<
    SekerDesktopBridge,
    'cancelAssetDragPreparation' | 'discardPreparedAssetDrag' | 'onAssetDragPreparationProgress'
  >;

export function getDesktopAssetDragBridge(
  libraryMode: LibraryMode = 'MATERIAL',
): DesktopAssetDragBridge | null {
  const candidate = (globalThis as { sekerDesktop?: Partial<SekerDesktopBridge> }).sekerDesktop;
  if (libraryMode === 'PHOTO') {
    if (
      candidate?.version !== 1 ||
      typeof candidate.prepareLibraryAssetDrag !== 'function' ||
      typeof candidate.startPreparedAssetDrag !== 'function'
    )
      return null;
    return {
      prepareAssetDrag: (assetIds) => candidate.prepareLibraryAssetDrag!({ assetIds, libraryMode }),
      startPreparedAssetDrag: candidate.startPreparedAssetDrag.bind(candidate),
      cancelAssetDragPreparation: candidate.cancelAssetDragPreparation?.bind(candidate),
      discardPreparedAssetDrag: candidate.discardPreparedAssetDrag?.bind(candidate),
      onAssetDragPreparationProgress: candidate.onAssetDragPreparationProgress?.bind(candidate),
    };
  }
  return candidate?.version === 1 &&
    typeof candidate.prepareAssetDrag === 'function' &&
    typeof candidate.startPreparedAssetDrag === 'function'
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
