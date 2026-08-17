import { describe, expect, it } from 'vitest';
import { applyEagleSelection } from './eagle-selection';

const orderedIds = ['one', 'two', 'three', 'four'];

describe('applyEagleSelection', () => {
  it('replaces the selection for a plain click', () => {
    expect(
      applyEagleSelection({
        orderedIds,
        selectedIds: ['one', 'two'],
        activeId: 'two',
        anchorId: 'one',
        clickedId: 'three',
        gesture: 'single',
      }),
    ).toEqual({
      selectedIds: ['three'],
      activeId: 'three',
      anchorId: 'three',
      isBatchSelection: false,
    });
  });

  it('toggles one item while preserving ordered multi-selection', () => {
    const added = applyEagleSelection({
      orderedIds,
      selectedIds: ['one'],
      activeId: 'one',
      anchorId: 'one',
      clickedId: 'three',
      gesture: 'toggle',
    });
    expect(added.selectedIds).toEqual(['one', 'three']);
    expect(added.isBatchSelection).toBe(true);

    expect(
      applyEagleSelection({
        orderedIds,
        selectedIds: added.selectedIds,
        activeId: added.activeId,
        anchorId: added.anchorId,
        clickedId: 'three',
        gesture: 'toggle',
      }),
    ).toMatchObject({
      selectedIds: ['one'],
      activeId: 'one',
      isBatchSelection: true,
    });
  });

  it('selects one continuous range from the stable anchor', () => {
    expect(
      applyEagleSelection({
        orderedIds,
        selectedIds: ['two'],
        activeId: 'two',
        anchorId: 'two',
        clickedId: 'four',
        gesture: 'range',
      }),
    ).toEqual({
      selectedIds: ['two', 'three', 'four'],
      activeId: 'four',
      anchorId: 'two',
      isBatchSelection: true,
    });
  });
});

