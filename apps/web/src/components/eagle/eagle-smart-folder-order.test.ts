import { describe, expect, it } from 'vitest';
import type { EagleSmartFolder } from '../../lib/eagle-api';
import { moveSmartFolderInTree } from './eagle-smart-folder-order';

const folder = (id: string, parentId: string | null, position: number): EagleSmartFolder => ({
  id,
  name: id,
  color: null,
  parentId,
  queryVersion: 1,
  queryJson: { version: 1, filters: {} },
  position,
  rowVersion: 1,
});

describe('moveSmartFolderInTree', () => {
  it('reindexes a move within the same sibling list', () => {
    const moved = moveSmartFolderInTree(
      [folder('a', null, 0), folder('b', null, 1), folder('c', null, 2)],
      'c',
      { parentId: null, position: 0 },
    );

    expect(moved.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
      { id: 'c', position: 0 },
    ]);
  });

  it('reindexes both sibling lists when moving into another parent', () => {
    const moved = moveSmartFolderInTree(
      [
        folder('root-a', null, 0),
        folder('leaf-a', 'root-a', 0),
        folder('leaf-b', 'root-a', 1),
        folder('root-b', null, 1),
        folder('leaf-c', 'root-b', 0),
      ],
      'leaf-a',
      { parentId: 'root-b', position: 0 },
    );

    expect(moved.map(({ id, parentId, position }) => ({ id, parentId, position }))).toEqual([
      { id: 'root-a', parentId: null, position: 0 },
      { id: 'leaf-a', parentId: 'root-b', position: 0 },
      { id: 'leaf-b', parentId: 'root-a', position: 0 },
      { id: 'root-b', parentId: null, position: 1 },
      { id: 'leaf-c', parentId: 'root-b', position: 1 },
    ]);
  });
});

