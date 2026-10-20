import { describe, it, expect } from 'vitest';
import { collapsePhotoStacks } from './photo-stacks';
import type { EagleAssetListItem, EaglePhotoStack } from '../../lib/eagle-api';
const asset = (id: string) => ({ id }) as EagleAssetListItem;
describe('photo stacks', () => {
  it('collapses a group across pages and uses its explicit cover', () => {
    const cover = asset('best');
    const stack = {
      id: 'group',
      bestAssetId: 'best',
      assetIds: ['one', 'two', 'best'],
      cover,
    } as EaglePhotoStack;
    expect(
      collapsePhotoStacks([asset('one'), asset('other'), asset('two')], [stack]).map(
        (row) => row.id,
      ),
    ).toEqual(['best', 'other']);
  });
  it('never hides an unrelated photo or invents a stack for a single visible member', () => {
    const only = asset('one');
    expect(
      collapsePhotoStacks(
        [only, asset('other')],
        [{ id: 'group', assetIds: ['one'], cover: only } as EaglePhotoStack],
      ).map((row) => row.id),
    ).toEqual(['one', 'other']);
  });
});

it('keeps a group at its timeline anchor when the selected cover changes', () => {
  const cover = { ...asset('edited'), chronologicalAt: '2020-05-01T00:00:00Z' };
  const stack = {
    id: 'group',
    assetIds: ['source', 'edited'],
    cover,
    timelineAt: '2020-05-02T00:00:00Z',
  } as EaglePhotoStack;
  const [displayed] = collapsePhotoStacks([asset('source')], [stack]);
  expect(displayed.chronologicalAt).toBe(stack.timelineAt);
  expect(cover.chronologicalAt).toBe('2020-05-01T00:00:00Z');
});
