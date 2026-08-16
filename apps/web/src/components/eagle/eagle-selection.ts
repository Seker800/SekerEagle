export type EagleSelectionGesture = 'single' | 'toggle' | 'range';

interface ApplyEagleSelectionInput {
  orderedIds: string[];
  selectedIds: string[];
  activeId: string | null;
  anchorId: string | null;
  clickedId: string;
  gesture: EagleSelectionGesture;
}

export interface EagleSelectionResult {
  selectedIds: string[];
  activeId: string | null;
  anchorId: string | null;
  isBatchSelection: boolean;
}

export function applyEagleSelection({
  orderedIds,
  selectedIds,
  activeId,
  anchorId,
  clickedId,
  gesture,
}: ApplyEagleSelectionInput): EagleSelectionResult {
  if (gesture === 'single') {
    return {
      selectedIds: [clickedId],
      activeId: clickedId,
      anchorId: clickedId,
      isBatchSelection: false,
    };
  }

  if (gesture === 'range') {
    const rangeAnchor =
      anchorId && orderedIds.includes(anchorId)
        ? anchorId
        : activeId && orderedIds.includes(activeId)
          ? activeId
          : clickedId;
    const anchorIndex = orderedIds.indexOf(rangeAnchor);
    const clickedIndex = orderedIds.indexOf(clickedId);
    const rangeIds =
      anchorIndex >= 0 && clickedIndex >= 0
        ? orderedIds.slice(
            Math.min(anchorIndex, clickedIndex),
            Math.max(anchorIndex, clickedIndex) + 1,
          )
        : [clickedId];

    return {
      selectedIds: rangeIds,
      activeId: clickedId,
      anchorId: rangeAnchor,
      isBatchSelection: true,
    };
  }

  const selected = new Set(selectedIds);
  if (selected.has(clickedId)) selected.delete(clickedId);
  else selected.add(clickedId);
  const nextIds = orderedIds.filter((id) => selected.has(id));
  const clickedRemainsSelected = selected.has(clickedId);
  const nextActiveId = clickedRemainsSelected
    ? clickedId
    : activeId === clickedId
      ? (nextIds.at(-1) ?? null)
      : activeId;

  return {
    selectedIds: nextIds,
    activeId: nextActiveId,
    anchorId: nextIds.length > 0 ? clickedId : null,
    isBatchSelection: nextIds.length > 0,
  };
}
