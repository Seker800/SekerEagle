import { applyPhotoPersonMerge } from './photo-person-merge-cache';
import { ApiError } from '../../lib/api-error';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { t } from '../../i18n';
import {
  getPhotoPeopleReview,
  mergeSelectedPhotoPeople,
  decidePhotoPeople,
  type PhotoPerson,
  type PhotoPersonReview,
} from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { PhotoFaceImage, representativeFace } from './PhotoFaceImage';
type ReviewPage = { items: PhotoPersonReview[]; nextCursor: string | null };
type ReviewEdits = { removed: string[]; updates: Record<string, Partial<PhotoPerson>> };
const PAGE_SIZE = 9;
const configuredPrefetch = Number(import.meta.env.VITE_PHOTO_REVIEW_PREFETCH_PAGES ?? 1);
const PREFETCH_PAGES =
  Number.isSafeInteger(configuredPrefetch) && configuredPrefetch > 0 ? configuredPrefetch : 0;
export function PhotoPeopleReview({
  ownerId,
  includePrivate,
  scopeRevision = '',
  pending,
  onChanged,
  onOpen,
  preview,
}: {
  ownerId: string | null;
  includePrivate: boolean;
  scopeRevision?: string;
  pending: boolean;
  onChanged: (privacy: boolean) => Promise<unknown>;
  onOpen: (asset: EagleAssetListItem) => void;
  preview: (asset: EagleAssetListItem) => string | null;
}) {
  const client = useQueryClient();
  const queryKey = [
    'eagle',
    ownerId,
    'PHOTO',
    'person-review',
    includePrivate,
    scopeRevision,
    'count-first-v3',
  ];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getPhotoPeopleReview(pageParam, signal),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
  });
  const editsKey = [...queryKey, 'edits'];
  const edits = useQuery<ReviewEdits>({
    queryKey: editsKey,
    enabled: false,
    queryFn: () => Promise.resolve({ removed: [], updates: {} }),
    initialData: { removed: [], updates: {} },
  }).data;
  const [batchIndex, setBatchIndex] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState('');
  const [result, setResult] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const people = useMemo(() => {
    const distinct = new Map<string, PhotoPerson>();
    for (const pair of query.data?.pages[batchIndex]?.items ?? []) {
      for (const person of [pair.first, pair.second]) {
        if (
          distinct.has(person.id) ||
          edits.removed.includes(person.id) ||
          !representativeFace(person)
        )
          continue;
        const update = edits.updates[person.id];
        distinct.set(
          person.id,
          update && (update.rowVersion ?? 0) > person.rowVersion
            ? { ...person, ...update }
            : person,
        );
      }
    }
    return [...distinct.values()]
      .filter((person) => !visited.has(person.id))
      .sort((a, b) => (b.photoCount ?? 0) - (a.photoCount ?? 0) || a.id.localeCompare(b.id));
  }, [query.data, batchIndex, visited, edits]);
  const cards = people.slice(0, PAGE_SIZE);
  const chosen = cards.filter((p) => selected.has(p.id));
  const preferred = [...chosen].sort(
    (a, b) =>
      Number(Boolean(b.name)) - Number(Boolean(a.name)) ||
      (b.photoCount ?? 0) - (a.photoCount ?? 0) ||
      a.id.localeCompare(b.id),
  )[0];
  const target = chosen.find((p) => p.id === targetId) ?? preferred;
  const busy = pending || saving;
  const { fetchNextPage, hasNextPage, isFetching, isFetchNextPageError } = query;
  useEffect(() => {
    const loaded = query.data?.pages.length ?? 0;
    if (!people.length && batchIndex + 1 < loaded) {
      setBatchIndex((i) => i + 1);
      setVisited(new Set());
      return;
    }
    // Only one server batch ahead. The same person can appear with a different
    // neighbour later; deduplicating the entire traversal would lose comparisons.
    if (
      loaded < batchIndex + 1 + (people.length ? PREFETCH_PAGES : 1) &&
      hasNextPage &&
      !isFetching &&
      !isFetchNextPageError &&
      !busy
    )
      void fetchNextPage();
  }, [
    batchIndex,
    people.length,
    query.data?.pages.length,
    hasNextPage,
    isFetching,
    isFetchNextPageError,
    busy,
    fetchNextPage,
  ]);
  // Keep a bounded, reusable preview window; originals are never prefetched.
  const warmed = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    const urls = new Set(
      people.slice(0, PREFETCH_PAGES ? PAGE_SIZE * (1 + PREFETCH_PAGES) : 0).flatMap((p) => {
        const face = representativeFace(p);
        const src = face && preview(face.asset);
        return src ? [src] : [];
      }),
    );
    for (const [src, img] of warmed.current)
      if (!urls.has(src)) {
        img.src = '';
        warmed.current.delete(src);
      }
    for (const src of urls)
      if (!warmed.current.has(src)) {
        const img = new Image();
        img.src = src;
        warmed.current.set(src, img);
      }
  }, [people, preview]);
  useEffect(() => {
    const images = warmed.current;
    return () => {
      for (const img of images.values()) img.src = '';
      images.clear();
    };
  }, []);
  function updatePeople(removed: Set<string>, updates: Map<string, Partial<PhotoPerson>>) {
    client.setQueryData<ReviewEdits>(editsKey, (current) => ({
      removed: [...new Set([...(current?.removed ?? []), ...removed])],
      updates: { ...current?.updates, ...Object.fromEntries(updates) },
    }));
  }
  async function refreshCurrentBatch() {
    const original = client.getQueryCache().find({ queryKey, exact: true });
    const storedParam = query.data?.pageParams[batchIndex];
    const param = typeof storedParam === 'string' ? storedParam : undefined;
    const page = await client.fetchQuery({
      queryKey: [...queryKey, 'refresh-batch', param ?? 'first'],
      gcTime: 0,
      retry: false,
      queryFn: ({ signal }) => getPhotoPeopleReview(param, signal),
    });
    if (client.getQueryCache().find({ queryKey, exact: true }) !== original) return;
    client.setQueryData<InfiniteData<ReviewPage, string | undefined>>(queryKey, (current) =>
      current
        ? { ...current, pages: current.pages.map((p, i) => (i === batchIndex ? page : p)) }
        : current,
    );
    setSelected(new Set());
    setTargetId('');
  }
  async function commit(kind: 'MERGE' | 'DIFFERENT') {
    if (submitting.current || chosen.length < 2 || !target) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      let privacy = false;
      if (kind === 'MERGE') {
        const merged = await mergeSelectedPhotoPeople({
          targetId: target.id,
          people: chosen.map((p) => ({ id: p.id, rowVersion: p.rowVersion })),
        });
        applyPhotoPersonMerge(client, ownerId, merged);
        privacy = merged.marksAssetsPrivate && chosen.some((p) => !p.marksAssetsPrivate);
        setResult(t('人物已合并'));
      } else {
        if (chosen.length !== 2) return;
        const [a, b] = chosen as [PhotoPerson, PhotoPerson];
        const decision = await decidePhotoPeople({
          firstId: a.id,
          secondId: b.id,
          firstVersion: a.rowVersion,
          secondVersion: b.rowVersion,
          decision: 'DIFFERENT',
        });
        updatePeople(
          new Set(),
          new Map((decision.people ?? []).map((p) => [p.id, { rowVersion: p.rowVersion }])),
        );
        setResult(t('已记住：不是同一个人。'));
      }
      setSelected(new Set());
      setTargetId('');
      // Related directory/count updates run independently; they do not replay review pages.
      void onChanged(privacy).catch((reason) =>
        setError(reason instanceof Error ? reason.message : t('操作失败')),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
      if (reason instanceof ApiError && (reason.status === 409 || reason.status === 404)) {
        try {
          await refreshCurrentBatch();
        } catch (refreshError) {
          setError(refreshError instanceof Error ? refreshError.message : t('操作失败'));
        }
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <section className="photo-people-review" aria-label={t('相似人物确认')}>
      <h3>{t('相似人物确认')}</h3>
      <p>{t('选择属于同一个人的分组，合并到保留的人物。每页显示 9 个分组。')}</p>
      {(error || query.error) && <p role="alert">{error ?? query.error?.message}</p>}
      {result && <p role="status">{result}</p>}
      {query.isPending ? (
        <p role="status">{t('正在查找相似人物…')}</p>
      ) : query.isError && !query.data ? (
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t('重试')}
        </button>
      ) : cards.length ? (
        <>
          <div className="photo-people-review-grid">
            {cards.map((person, index) => {
              const face = representativeFace(person)!;
              const name = person.name ?? t('未命名分组 {{value1}}', { value1: index + 1 });
              return (
                <article key={person.id} data-selected={selected.has(person.id)}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={t('选择 {{value1}}', { value1: name })}
                      checked={selected.has(person.id)}
                      disabled={busy}
                      onChange={() => {
                        setSelected((old) => {
                          const next = new Set(old);
                          if (next.has(person.id)) next.delete(person.id);
                          else next.add(person.id);
                          return next;
                        });
                        setError(null);
                      }}
                    />
                    <PhotoFaceImage face={face} url={preview} alt={name} />
                    <strong>{name}</strong>
                    <span>{t('{{value1}} 张照片', { value1: person.photoCount ?? 0 })}</span>
                  </label>
                  <button type="button" onClick={() => onOpen(face.asset)}>
                    {t('查看照片')}
                  </button>
                </article>
              );
            })}
          </div>
          {chosen.length > 0 && (
            <label>
              {t('保留人物')}
              <select
                aria-label={t('保留人物')}
                value={target?.id ?? ''}
                disabled={busy}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {chosen.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ??
                      t('未命名分组 {{value1}}', {
                        value1: cards.findIndex((card) => card.id === p.id) + 1,
                      })}{' '}
                    · {t('{{value1}} 张照片', { value1: p.photoCount ?? 0 })}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="photo-people-review-actions">
            <button
              type="button"
              disabled={busy || chosen.length < 2}
              onClick={() => void commit('MERGE')}
            >
              {saving ? t('正在合并…') : t('合并所选人物')}
            </button>
            <button
              type="button"
              disabled={busy || chosen.length !== 2}
              onClick={() => void commit('DIFFERENT')}
            >
              {t('不是同一个人')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSelected(new Set());
                setTargetId('');
                if (
                  people.length <= PAGE_SIZE &&
                  ((query.data?.pages.length ?? 0) > batchIndex + 1 || hasNextPage)
                ) {
                  setBatchIndex((i) => i + 1);
                  setVisited(new Set());
                } else setVisited((old) => new Set([...old, ...cards.map((p) => p.id)]));
                setError(null);
              }}
            >
              {t('下一组')}
            </button>
          </div>
        </>
      ) : query.hasNextPage ? (
        <>
          <p role="status">{t('正在查找相似人物…')}</p>
          {query.isFetchNextPageError && (
            <button type="button" disabled={isFetching} onClick={() => void fetchNextPage()}>
              {t('继续查找相似人物')}
            </button>
          )}
        </>
      ) : (
        <p>{t('暂时没有需要确认的相似人物。')}</p>
      )}
    </section>
  );
}
