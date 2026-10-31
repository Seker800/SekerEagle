import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { t } from '../../i18n';
import { ApiError } from '../../lib/api-error';
import {
  listPhotoPeopleOptions,
  mergeSelectedPhotoPeople,
  type PhotoPerson,
  type PhotoPersonOption,
  type PhotoPersonMergeResult,
} from '../../lib/photo-management-api';

export function PhotoPersonMergeSelection({
  ownerId,
  includePrivate,
  scopeRevision,
  selected,
  onClear,
  onMerged,
  onPendingChange,
  onConflict,
}: {
  ownerId: string | null;
  includePrivate: boolean;
  scopeRevision: string;
  selected: PhotoPerson[];
  onClear: () => void;
  onPendingChange: (pending: boolean) => void;
  onConflict: () => Promise<unknown>;
  onMerged: (result: PhotoPersonMergeResult, privacy: boolean) => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const targets = useInfiniteQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people-merge-targets', includePrivate, scopeRevision],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listPhotoPeopleOptions(pageParam, signal, 'NAMED'),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: selected.length > 0,
    staleTime: 30000,
    retry: false,
  });
  if (!selected.length) return null;
  const choices = [
    ...new Map<string, PhotoPersonOption>([
      ...selected.map((p) => [p.id, p] as const),
      ...(targets.data?.pages.flatMap((p) => p.people) ?? []).map((p) => [p.id, p] as const),
    ]).values(),
  ];
  const target = choices.find((p) => p.id === targetId) ?? selected[0];
  const members = [...selected.filter((p) => p.id !== target.id), target];
  async function merge() {
    if (submitting.current || members.length < 2 || conflicted) return;
    submitting.current = true;
    setSaving(true);
    onPendingChange(true);
    setError(null);
    try {
      const result = await mergeSelectedPhotoPeople({
        targetId: target.id,
        people: members.map((p) => ({ id: p.id, rowVersion: p.rowVersion })),
      });
      if (!active.current) return;
      onMerged(result, result.marksAssetsPrivate && members.some((p) => !p.marksAssetsPrivate));
    } catch (reason) {
      if (!active.current) return;
      setError(reason instanceof Error ? reason.message : t('操作失败'));
      if (reason instanceof ApiError && [404, 409].includes(reason.status)) {
        setConflicted(true);
        await onConflict().catch(() => undefined);
      }
    } finally {
      submitting.current = false;
      if (active.current) {
        setSaving(false);
        onPendingChange(false);
      }
    }
  }
  return (
    <section className="photo-person-merge-selection" aria-label={t('合并分组')}>
      <strong>{t('已选择 {{value1}} 个分组', { value1: selected.length })}</strong>
      <label>
        {t('合并到人物')}
        <select
          aria-label={t('合并到人物')}
          disabled={saving}
          value={target.id}
          onChange={(e) => setTargetId(e.target.value)}
        >
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ??
                t('未命名分组 {{value1}}', {
                  value1: selected.findIndex((s) => s.id === p.id) + 1,
                })}
            </option>
          ))}
        </select>
      </label>
      {targets.isFetching && <p role="status">{t('正在加载人物…')}</p>}
      {targets.error && (
        <p role="alert">
          {targets.error.message}
          <button type="button" onClick={() => void targets.refetch()}>
            {t('重试')}
          </button>
        </p>
      )}
      {targets.hasNextPage && (
        <button
          type="button"
          disabled={targets.isFetchingNextPage}
          onClick={() => void targets.fetchNextPage()}
        >
          {t('加载更多目标人物')}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {conflicted && <p>{t('分组已变化，请清除选择后重新选择。')}</p>}
      <button
        type="button"
        disabled={saving || members.length < 2 || conflicted}
        onClick={() => void merge()}
      >
        {saving ? t('正在合并…') : t('合并所选分组')}
      </button>
      <button type="button" disabled={saving} onClick={onClear}>
        {t('清除选择')}
      </button>
    </section>
  );
}
