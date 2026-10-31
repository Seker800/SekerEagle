import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { applyPhotoPersonMerge } from './photo-person-merge-cache';
it('projects an atomic merge across cached pages without changing page params or another owner', () => {
  const client = new QueryClient();
  const key = ['eagle', 'owner', 'PHOTO', 'people', false, 'UNNAMED', 'cards'];
  const other = ['eagle', 'other', 'PHOTO', 'people', false, 'UNNAMED', 'cards'];
  const data = {
    pages: [
      { people: [{ id: 'a', rowVersion: 1, photoCount: 10 }] },
      { people: [{ id: 'b', rowVersion: 1, photoCount: 5 }] },
    ],
    pageParams: [undefined, 'next'],
  };
  client.setQueryData(key, data);
  client.setQueryData(other, data);
  const targets = ['eagle', 'owner', 'PHOTO', 'people-merge-targets', false, 'scope'];
  client.setQueryData(targets, data);
  const review = ['eagle', 'owner', 'PHOTO', 'person-review', false, 'scope', 'count-first-v3'];
  client.setQueryData(review, { pages: [{ items: [] }], pageParams: [undefined] });
  client.setQueryData([...review, 'edits'], {
    removed: ['old'],
    updates: { old: { rowVersion: 2 } },
  });
  applyPhotoPersonMerge(client, 'owner', {
    id: 'a',
    rowVersion: 2,
    photoCount: 15,
    mergedIds: ['b'],
    marksAssetsPrivate: false,
  });
  expect(client.getQueryData(key)).toEqual({
    pages: [
      {
        people: [
          { id: 'a', rowVersion: 2, photoCount: 15, mergedIds: ['b'], marksAssetsPrivate: false },
        ],
      },
      { people: [] },
    ],
    pageParams: [undefined, 'next'],
  });
  expect(client.getQueryData(other)).toEqual(data);
  expect(client.getQueryData(targets)).toEqual(client.getQueryData(key));
  expect(client.getQueryData([...review, 'edits'])).toMatchObject({
    removed: ['old', 'b'],
    updates: { a: { rowVersion: 2 } },
  });
});
it('removes newly private targets from public projections and never recreates removed caches', () => {
  const c = new QueryClient();
  const pub = ['eagle', 'owner', 'PHOTO', 'people', false, 'ALL'];
  const priv = ['eagle', 'owner', 'PHOTO', 'people', true, 'ALL'];
  const review = ['eagle', 'owner', 'PHOTO', 'person-review', false, 'scope'];
  for (const key of [pub, priv])
    c.setQueryData(key, {
      pages: [{ people: [{ id: 'a' }, { id: 'b' }] }],
      pageParams: [undefined],
    });
  c.setQueryData(review, { pages: [], pageParams: [] });
  c.setQueryData([...review, 'empty'], null);
  applyPhotoPersonMerge(c, 'owner', {
    id: 'a',
    rowVersion: 2,
    photoCount: 2,
    mergedIds: ['b'],
    marksAssetsPrivate: true,
  });
  expect(c.getQueryData(pub)).toMatchObject({ pages: [{ people: [] }] });
  expect(c.getQueryData(priv)).toMatchObject({
    pages: [{ people: [{ id: 'a', marksAssetsPrivate: true }] }],
  });
  expect(c.getQueryData([...review, 'edits'])).toMatchObject({ removed: ['b', 'a'], updates: {} });
  c.clear();
  applyPhotoPersonMerge(c, 'owner', {
    id: 'a',
    rowVersion: 3,
    photoCount: 2,
    mergedIds: [],
    marksAssetsPrivate: false,
  });
  expect(c.getQueryCache().getAll()).toHaveLength(0);
});
