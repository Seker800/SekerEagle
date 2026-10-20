import { expect, it } from 'vitest';
import { photoLutFileName, groupPhotoFilters } from './photo-lut-groups';
it('reads optional local group and order prefixes without changing ordinary names', () => {
  expect(photoLutFileName('02-Portrait__03-Soft.cube')).toEqual({
    name: 'Soft',
    group: 'Portrait',
    groupOrder: 2,
    order: 3,
  });
  expect(photoLutFileName('Film__Warm.png')).toEqual({ name: 'Warm', group: 'Film' });
  expect(photoLutFileName('My-own.cube')).toEqual({ name: 'My-own' });
  expect(photoLutFileName('Empty__.cube')).toEqual({ name: 'Empty__' });
});
it('places locally prioritized groups first and keeps originals at the beginning without losing filters', () => {
  const groups = groupPhotoFilters([
    { id: 'b', name: 'Second', size: 2, group: 'Film', groupOrder: 2 },
    { id: 'a', name: 'Favorite', size: 2, group: 'Priority', groupOrder: 1, order: 1 },
    { id: 'c', name: 'Another', size: 2, group: 'Priority', groupOrder: 1, order: 2 },
    { id: 'd', name: 'Ungrouped', size: 2 },
  ]);
  expect(groups.map((g) => g.label)).toEqual(['Priority', 'Film', '其他', '基础']);
  expect(groups[0].items.map((i) => i.id)).toEqual(['lut:a', 'lut:c']);
  expect(groups.flatMap((g) => g.items)).toHaveLength(7);
});
