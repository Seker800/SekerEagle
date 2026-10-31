import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoCollections } from './PhotoCollections';
import type { PhotoPerson } from '../../lib/photo-management-api';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  suggest: vi.fn(),
  decide: vi.fn(),
  merge: vi.fn(),
}));
vi.mock('../../lib/photo-management-api', () => ({
  listPhotoPeople: mocks.list,
  listPhotoPersonFaces: vi.fn().mockResolvedValue({ faces: [], nextCursor: null }),
  getPhotoPeopleSummary: mocks.summary,
  getPhotoPeopleReview: mocks.suggest,
  decidePhotoPeople: mocks.decide,
  mergeSelectedPhotoPeople: mocks.merge,
  scanPhotoPeople: vi.fn(),
  renamePhotoPerson: vi.fn(),
  splitPhotoFace: vi.fn(),
  updatePhotoPersonPrivacy: vi.fn(),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({
    ownerId: 'owner',
    api: { getEagleRenditionContentUrl: (id: string) => `/${id}` },
  }),
}));
const person = (id: string, name: string | null = null) =>
  ({
    id,
    name,
    rowVersion: 1,
    marksAssetsPrivate: false,
    faces: [
      {
        id: `face-${id}`,
        box: [0.2, 0.2, 0.3, 0.3],
        confidence: 0.99,
        assetId: id,
        asset: {
          id,
          displayName: id,
          mimeType: 'image/jpeg',
          mediaRevision: 1,
          width: 1600,
          height: 1200,
          renditions: [
            {
              id: 'preview',
              kind: 'PREVIEW',
              variant: 'default',
              revision: 1,
              mimeType: 'image/jpeg',
              width: 1600,
              height: 1200,
            },
          ],
        },
      },
    ],
  }) as PhotoPerson;
const a = person('a'),
  b = person('b', '小明'),
  c = person('c');
const items = [
  { key: 'a:b', first: a, second: b, similarity: 0.7 },
  { key: 'b:c', first: b, second: c, similarity: 0.6 },
];
const show = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <PhotoCollections
        includePrivate={false}
        onPrivacyRulesChange={vi.fn()}
        onOpen={vi.fn()}
        onPerson={vi.fn()}
      />
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ runtimeConfigured: true, people: [b], nextCursor: null });
  mocks.summary.mockResolvedValue({ named: 1, unnamed: 3000 });
  mocks.suggest.mockResolvedValue({ items, nextCursor: null });
  mocks.decide.mockResolvedValue({ saved: true });
});

it('keeps named directory as the default and loads review only on demand', async () => {
 show();await screen.findByRole('button',{name:'小明'});expect(mocks.suggest).not.toHaveBeenCalled();
});
it('shows nine selectable people and moves forward without recomputing prior pages', async () => {
 const persons=Array.from({length:13},(_,i)=>({...person(`person-${i}`),photoCount:13-i}));
 mocks.suggest.mockResolvedValue({items:persons.slice(1).map(p=>({key:`${persons[0].id}:${p.id}`,first:persons[0],second:p,similarity:.8})),nextCursor:null});
 show();fireEvent.click(await screen.findByRole('button',{name:'开始确认人物'}));
 await waitFor(()=>expect(screen.getAllByRole('checkbox')).toHaveLength(9));
 fireEvent.click(screen.getByRole('button',{name:'下一组'}));
 await waitFor(()=>expect(screen.getAllByRole('checkbox')).toHaveLength(4));expect(mocks.suggest).toHaveBeenCalledTimes(1);
});
it('merges selected cards in one versioned request and does not wait for a candidate replay', async () => {
 mocks.merge.mockResolvedValue({id:'b',rowVersion:2,photoCount:6,marksAssetsPrivate:false});
 show();fireEvent.click(await screen.findByRole('button',{name:'开始确认人物'}));
 fireEvent.click(await screen.findByRole('checkbox',{name:'选择 a'}));fireEvent.click(screen.getByRole('checkbox',{name:'选择 小明'}));
 expect(screen.getByRole('button',{name:'合并所选人物'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'合并所选人物'}));
 await waitFor(()=>expect(mocks.merge).toHaveBeenCalledWith({targetId:'b',people:[{id:'a',rowVersion:1},{id:'b',rowVersion:1}]}));
 expect(await screen.findByText('人物已合并')).toBeVisible();expect(mocks.suggest).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('checkbox',{name:'选择 a'})).not.toBeInTheDocument();
});
it('failed merges preserve selection and can retry without losing the page', async () => {
 mocks.merge.mockRejectedValue(new Error('人物已变化，请重新选择。'));show();fireEvent.click(await screen.findByRole('button',{name:'开始确认人物'}));
 fireEvent.click(await screen.findByRole('checkbox',{name:'选择 a'}));fireEvent.click(screen.getByRole('checkbox',{name:'选择 小明'}));fireEvent.click(screen.getByRole('button',{name:'合并所选人物'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('人物已变化');expect(screen.getByRole('checkbox',{name:'选择 a'})).toBeChecked();
});
it('automatically traverses empty pages and shows empty only at the end', async () => {
 mocks.suggest.mockImplementation(async(after?:string)=>!after?{items:[],nextCursor:'next'}:{items,nextCursor:null});show();fireEvent.click(await screen.findByRole('button',{name:'开始确认人物'}));await screen.findByRole('checkbox',{name:'选择 a'});expect(mocks.suggest).toHaveBeenCalledTimes(2);
});
it('does not invent people in an empty review', async () => {
 mocks.suggest.mockResolvedValue({items:[],nextCursor:null});show();fireEvent.click(await screen.findByRole('button',{name:'开始确认人物'}));expect(await screen.findByText('暂时没有需要确认的相似人物。')).toBeVisible();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
