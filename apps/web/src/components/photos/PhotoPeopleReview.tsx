import { useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { t } from '../../i18n';
import { getPhotoPeopleReview, decidePhotoPeople } from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { PhotoFaceImage, representativeFace } from './PhotoFaceImage';
export function PhotoPeopleReview({
  ownerId,
  includePrivate,
  pending,
  onChanged,
  onOpen,
  preview,
}: {
  ownerId: string | null;
  includePrivate: boolean;
  pending: boolean;
  onChanged: (privacy: boolean) => Promise<unknown>;
  onOpen: (asset: EagleAssetListItem) => void;
  preview: (asset: EagleAssetListItem) => string | null;
}) {
  const query = useInfiniteQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'person-review', includePrivate],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getPhotoPeopleReview(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30000,
  });
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const all = query.data?.pages.flatMap((p) => p.items) ?? [];
  const pair = all.find(
    (item) =>
      !skipped.has(item.key) && representativeFace(item.first) && representativeFace(item.second),
  );
  const busy = pending || saving;
  async function decide(decision: 'SAME' | 'DIFFERENT') {
    if (!pair || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    const target = pair.first.name && !pair.second.name ? pair.first : pair.second;
    const source = target === pair.first ? pair.second : pair.first;
    try {
      await decidePhotoPeople({
        firstId: source.id,
        secondId: target.id,
        firstVersion: source.rowVersion,
        secondVersion: target.rowVersion,
        decision,
      });
      setSkipped((old) => new Set([...old, pair.key]));
      setResult(decision === 'SAME' ? t('人物已合并') : t('已记住：不是同一个人。'));
      await onChanged(decision === 'SAME');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <section className="photo-people-review" aria-label={t('这两张照片是同一个人吗？')}>
      <h3>{t('这两张照片是同一个人吗？')}</h3>
      <p>{t('按相似程度推荐，需要你确认；不会自动合并。')}</p>
      {(error || query.error) && <p role="alert">{error ?? query.error?.message}</p>}
      {result && <p role="status">{result}</p>}
      {query.isPending ? (
        <p role="status">{t('正在查找相似人物…')}</p>
      ) : pair ? (
        <>
          <div className="photo-people-review-pair">
            {[pair.first, pair.second].map((person) => {
              const face = representativeFace(person);
              return face ? (
                <button key={person.id} type="button" onClick={() => onOpen(face.asset)}>
                  <img
                    className="photo-people-review-original"
                    src={preview(face.asset) ?? undefined}
                    alt={t('完整照片：{{value1}}', { value1: face.asset.displayName })}
                  />
                  <PhotoFaceImage face={face} url={preview} alt={person.name ?? t('未命名人物')} />
                  <span>{person.name ?? t('未命名人物')}</span>
                  {person.photoCount !== undefined && (
                    <span>{t('{{value1}} 张照片', { value1: person.photoCount })}</span>
                  )}
                </button>
              ) : null;
            })}
          </div>
          <div className="photo-people-review-actions">
            <button
              type="button"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.repeat) event.preventDefault();
              }}
              onClick={(event) => {
                if (event.detail <= 1) void decide('SAME');
              }}
            >
              {t('是，同一个人')}
            </button>
            <button
              type="button"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.repeat) event.preventDefault();
              }}
              onClick={(event) => {
                if (event.detail <= 1) void decide('DIFFERENT');
              }}
            >
              {t('不是同一个人')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setSkipped((old) => new Set([...old, pair.key]));
              }}
            >
              {t('暂时跳过')}
            </button>
          </div>
        </>
      ) : query.hasNextPage ? (
        <button
          type="button"
          disabled={query.isFetchingNextPage || busy}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? t('正在查找相似人物…') : t('继续查找相似人物')}
        </button>
      ) : (
        <p>{t('暂时没有需要确认的相似人物。')}</p>
      )}
    </section>
  );
}
