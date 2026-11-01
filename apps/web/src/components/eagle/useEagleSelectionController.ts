import { useCallback, useReducer } from 'react';
import { applyEagleSelection, type EagleSelectionGesture } from './eagle-selection';

interface SelectionState {
  selectedAssetIds: string[];
  selectedAssetId: string | null;
  isBatchSelection: boolean;
  selectionMode: boolean;
  assetContextMenu: { x: number; y: number } | null;
  anchorId: string | null;
}
type Action =
  | { type: 'select'; orderedIds: string[]; id: string; gesture: EagleSelectionGesture }
  | { type: 'clear'; preserveMode: boolean }
  | { type: 'reconcile'; ids: ReadonlySet<string> }
  | { type: 'mode'; enabled: boolean }
  | { type: 'menu'; position: SelectionState['assetContextMenu'] };

function reduceSelection(state: SelectionState, action: Action): SelectionState {
  switch (action.type) {
    case 'select': {
      const next = applyEagleSelection({
        orderedIds: action.orderedIds,
        selectedIds: state.selectedAssetIds,
        activeId: state.selectedAssetId,
        anchorId: state.anchorId,
        clickedId: action.id,
        gesture: action.gesture,
      });
      return {
        ...state,
        selectedAssetIds: next.selectedIds,
        selectedAssetId: next.activeId,
        anchorId: next.anchorId,
        isBatchSelection: next.isBatchSelection,
      };
    }
    case 'clear':
      return {
        selectedAssetIds: [],
        selectedAssetId: null,
        isBatchSelection: false,
        selectionMode: action.preserveMode && state.selectionMode,
        assetContextMenu: null,
        anchorId: null,
      };
    case 'mode':
      return { ...state, selectionMode: action.enabled };
    case 'menu':
      return { ...state, assetContextMenu: action.position };
    case 'reconcile': {
      const selectedAssetIds = state.selectedAssetIds.filter((id) => action.ids.has(id));
      const selectedAssetId =
        state.selectedAssetId && action.ids.has(state.selectedAssetId)
          ? state.selectedAssetId
          : null;
      if (
        selectedAssetIds.length === state.selectedAssetIds.length &&
        selectedAssetId === state.selectedAssetId
      )
        return state;
      return { ...state, selectedAssetIds, selectedAssetId };
    }
  }
}

/** Owns selection, range anchor and context menu as one workspace interaction. */
export function useEagleSelectionController(
  initial: Partial<
    Pick<
      SelectionState,
      'selectedAssetIds' | 'selectedAssetId' | 'isBatchSelection' | 'selectionMode'
    >
  > = {},
) {
  const [state, dispatch] = useReducer(reduceSelection, initial, (saved): SelectionState => ({
    selectedAssetIds: [...(saved.selectedAssetIds ?? [])],
    selectedAssetId: saved.selectedAssetId ?? null,
    isBatchSelection: saved.isBatchSelection ?? false,
    selectionMode: saved.selectionMode ?? false,
    assetContextMenu: null,
    anchorId: null,
  }));
  const select = useCallback(
    (orderedIds: string[], id: string, gesture: EagleSelectionGesture) =>
      dispatch({ type: 'select', orderedIds, id, gesture }),
    [],
  );
  const clear = useCallback(
    (options?: { preserveMode?: boolean }) =>
      dispatch({ type: 'clear', preserveMode: options?.preserveMode === true }),
    [],
  );
  const reconcile = useCallback(
    (ids: ReadonlySet<string>) => dispatch({ type: 'reconcile', ids }),
    [],
  );
  const setSelectionMode = useCallback(
    (enabled: boolean) => dispatch({ type: 'mode', enabled }),
    [],
  );
  const setAssetContextMenu = useCallback(
    (position: SelectionState['assetContextMenu']) => dispatch({ type: 'menu', position }),
    [],
  );
  return { ...state, select, clear, reconcile, setSelectionMode, setAssetContextMenu };
}
