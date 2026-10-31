import { PhotoPersonMergeSelection } from './PhotoPersonMergeSelection';
import { applyPhotoPersonMerge } from './photo-person-merge-cache';
import { usePhotoPeople } from './use-photo-people';
import { getDesktopCacheBridge } from '../../lib/media-resolver';
import { useEffect, useRef, useState } from 'react';
import { PhotoFaceImage, facePreview, representativeFace } from './PhotoFaceImage';
import { PhotoPeopleReview } from './PhotoPeopleReview';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  scanPhotoPeople,
  listPhotoPersonFaces,
  renamePhotoPerson,
  getPhotoPeopleSummary,
  splitPhotoFace,
  updatePhotoPersonPrivacy,
  type PhotoPerson,
} from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';

export function PhotoCollections({
  includePrivate,
  scopeRevision = '',
  onOpen,
  onPerson,
  onPrivacyRulesChange,
}: {
  includePrivate: boolean;
  scopeRevision?: string;
  onPrivacyRulesChange: () => void;
  onOpen: (asset: EagleAssetListItem) => void;
  onPerson: (personId: string) => void;
}) {
  const { ownerId, api } = useLibraryWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [view, setView] = useState<'NAMED' | 'UNNAMED' | 'REVIEW'>('NAMED');
  const summary = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people-summary', includePrivate],
    queryFn: getPhotoPeopleSummary,
  });
  const people = usePhotoPeople(
    ownerId,
    includePrivate,
    view !== 'REVIEW',
    true,
    view === 'REVIEW' ? 'NAMED' : view,
  );
  const directoryScope = `${ownerId}:${includePrivate}:${scopeRevision}`;
  const [selectionState, setSelectionState] = useState<{
    scope: string;
    people: Record<string, PhotoPerson>;
  }>({ scope: directoryScope, people: {} });
  const directorySelection = selectionState.scope === directoryScope ? selectionState.people : {};
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const clearDirectorySelection = () => {
    setSelectionState({ scope: directoryScope, people: {} });
    setSelectionEpoch((value) => value + 1);
  };
  useEffect(() => {
    setSelectionState({ scope: directoryScope, people: {} });
    setPending(false);
  }, [directoryScope]);
  const actionPending = useRef(false);
  async function perform(
    action: () => Promise<unknown>,
    changesPrivacy = false,
    refreshReview = true,
  ) {
    if (actionPending.current) return false;
    actionPending.current = true;
    setError(null);
    setPending(true);
    try {
      await action();
      if (changesPrivacy) {
        onPrivacyRulesChange();
        try {
          await getDesktopCacheBridge()?.clearCache();
        } catch {
          setError(t('隐私规则已保存，但桌面媒体缓存清理失败。'));
        }
      }
      if (!changesPrivacy)
        await queryClient.invalidateQueries({
          queryKey: ['eagle', ownerId, 'PHOTO', 'asset-detail'],
        });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['eagle', ownerId, 'PHOTO', 'people'] }),
        summary.refetch(),
        ...(refreshReview
          ? [
              queryClient.invalidateQueries({
                queryKey: ['eagle', ownerId, 'PHOTO', 'person-review'],
              }),
            ]
          : []),
        queryClient.invalidateQueries({ queryKey: ['eagle', ownerId, 'PHOTO', 'person-faces'] }),
      ]);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
      return false;
    } finally {
      actionPending.current = false;
      setPending(false);
    }
  }
  async function afterReviewChange(changesPrivacy: boolean) {
    if (changesPrivacy) return perform(async () => {}, true, false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['eagle', ownerId, 'PHOTO', 'people-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['eagle', ownerId, 'PHOTO', 'person-faces'] }),
    ]);
  }
  const thumbnail = (asset: EagleAssetListItem) => {
    const rendition = facePreview(asset);
    return rendition
      ? api.getEagleRenditionContentUrl(asset.id, rendition.id, rendition.kind)
      : null;
  };
  return (
    <section className="photo-collections">
      <div className="photo-collections-header">
        <h2>{t('人物')}</h2>
        <button
          type="button"
          disabled={
            pending ||
            people.isPending ||
            Boolean(people.error) ||
            people.data?.runtimeConfigured !== true
          }
          onClick={() =>
            void perform(async () => {
              const result = await scanPhotoPeople();
              setFeedback(t('已加入 {{value1}} 个本地人脸分析任务', { value1: result.queued }));
            })
          }
        >
          {t('分析人物')}
        </button>
      </div>
      {view !== 'REVIEW' && people.isPending && <p role="status">{t('正在加载人物…')}</p>}
      {!people.isPending && !people.error && people.data?.runtimeConfigured === false && (
        <p role="status">{t('人物识别服务尚未配置，暂时无法分析照片。')}</p>
      )}
      {feedback && <p role="status">{feedback}</p>}
      {(error || people.error || summary.error) && (
        <p role="alert">{error ?? people.error?.message ?? summary.error?.message}</p>
      )}
      {
        <>
          <div className="photo-person-sections" role="tablist" aria-label={t('人物整理')}>
            {(
              [
                ['NAMED', t('已命名人物')],
                ['REVIEW', t('待确认')],
                ['UNNAMED', t('待整理分组')],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={view === id}
                disabled={pending}
                key={id}
                onClick={() => {
                  setView(id);
                  setSelectedPerson(null);
                }}
              >
                {label}
                {id === 'NAMED' && summary.data
                  ? ` (${summary.data.named})`
                  : id === 'UNNAMED' && summary.data
                    ? ` (${summary.data.unnamed})`
                    : ''}
              </button>
            ))}
          </div>
          {view === 'NAMED' && summary.data && summary.data.unnamed > 0 && (
            <p className="photo-person-hint">
              {t('有 {{value1}} 个自动分组待整理，同一个人可能出现在多个分组中；这不是实际人数。', {
                value1: summary.data.unnamed,
              })}
              <button type="button" onClick={() => setView('REVIEW')}>
                {t('开始确认人物')}
              </button>
            </p>
          )}
          {view === 'REVIEW' ? (
            <PhotoPeopleReview
              key={`${ownerId}:${includePrivate}:${scopeRevision}`}
              ownerId={ownerId}
              scopeRevision={scopeRevision}
              includePrivate={includePrivate}
              pending={pending}
              onChanged={afterReviewChange}
              onOpen={onOpen}
              preview={thumbnail}
            />
          ) : (
            <>
              {view === 'UNNAMED' && (
                <PhotoPersonMergeSelection
                  key={`${ownerId}:${includePrivate}:${scopeRevision}:${selectionEpoch}`}
                  ownerId={ownerId}
                  includePrivate={includePrivate}
                  scopeRevision={scopeRevision}
                  selected={Object.values(directorySelection)}
                  onClear={clearDirectorySelection}
                  onPendingChange={setPending}
                  onConflict={() =>
                    queryClient.invalidateQueries({
                      queryKey: ['eagle', ownerId, 'PHOTO', 'people'],
                    })
                  }
                  onMerged={(result, privacy) => {
                    applyPhotoPersonMerge(queryClient, ownerId, result);
                    clearDirectorySelection();
                    setSelectedPerson((current) =>
                      result.mergedIds.includes(current ?? '') ? null : current,
                    );
                    setFeedback(t('人物已合并'));
                    void afterReviewChange(privacy).catch((reason) =>
                      setError(reason instanceof Error ? reason.message : t('操作失败')),
                    );
                  }}
                />
              )}
              <div className="photo-person-grid">
                {people.data?.people.map((person, index) => {
                  const face = representativeFace(person),
                    src = face ? thumbnail(face.asset) : null;
                  return (
                    <article key={person.id} className="photo-person-selection-card">
                      {view === 'UNNAMED' && (
                        <input
                          type="checkbox"
                          aria-label={t('选择分组 {{value1}}', {
                            value1: person.name ?? index + 1,
                          })}
                          checked={Boolean(directorySelection[person.id])}
                          disabled={pending}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelectionState((current) => {
                              const next =
                                current.scope === directoryScope ? { ...current.people } : {};
                              if (checked) next[person.id] = person;
                              else delete next[person.id];
                              return { scope: directoryScope, people: next };
                            });
                          }}
                        />
                      )}
                      <button
                        type="button"
                        className="photo-person-card"
                        onClick={() => setSelectedPerson(person.id)}
                        aria-pressed={selectedPerson === person.id}
                      >
                        {src && face && <PhotoFaceImage face={face} url={thumbnail} />}
                        <strong>
                          {person.name ?? t('未命名分组 {{value1}}', { value1: index + 1 })}
                        </strong>
                        {person.photoCount !== undefined && (
                          <span>{t('{{value1}} 张照片', { value1: person.photoCount })}</span>
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
              {people.hasNextPage && (
                <button
                  type="button"
                  disabled={people.isFetchingNextPage}
                  onClick={() => void people.fetchNextPage()}
                >
                  {t('加载更多人物')}
                </button>
              )}
              {people.data?.people.find((person) => person.id === selectedPerson) && (
                <PersonEditor
                  key={selectedPerson}
                  includePrivate={includePrivate}
                  person={people.data.people.find((person) => person.id === selectedPerson)!}
                  pending={pending}
                  perform={(action, changesPrivacy) => perform(action, changesPrivacy)}
                  onPrivacyChange={(person, checked) =>
                    perform(async () => {
                      await updatePhotoPersonPrivacy(person, checked);
                      setFeedback(
                        checked && !includePrivate
                          ? t('已设为私密，开启显示隐私内容后可管理。')
                          : t('人物隐私规则已更新。'),
                      );
                    }, true)
                  }
                  onPerson={onPerson}
                  onOpen={onOpen}
                  thumbnail={thumbnail}
                />
              )}
            </>
          )}
          {view !== 'REVIEW' &&
            !people.isPending &&
            !people.error &&
            !feedback &&
            people.data?.runtimeConfigured === true &&
            people.data.people.length === 0 && (
              <p>
                {view === 'NAMED'
                  ? t('还没有已命名人物。可从待整理分组中命名，或先确认相似人物。')
                  : t('暂无待整理分组。')}
              </p>
            )}
        </>
      }
    </section>
  );
}
function PersonEditor({
  person,
  includePrivate,
  pending,
  perform,
  onPerson,
  onOpen,
  thumbnail,
  onPrivacyChange,
}: {
  person: PhotoPerson;
  includePrivate: boolean;
  pending: boolean;
  perform: (action: () => Promise<unknown>, changesPrivacy?: boolean) => Promise<boolean>;
  onPrivacyChange: (person: PhotoPerson, checked: boolean) => Promise<boolean>;
  onPerson: (id: string) => void;
  onOpen: (asset: EagleAssetListItem) => void;
  thumbnail: (asset: EagleAssetListItem) => string | null;
}) {
  const { ownerId } = useLibraryWorkspace();
  const faces = useInfiniteQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'person-faces', includePrivate, person.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listPhotoPersonFaces(person.id, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30000,
  });
  const [name, setName] = useState(person.name ?? '');
  return (
    <div className="photo-person-editor">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(() => renamePhotoPerson(person.id, name));
        }}
      >
        <label>
          {t('人物名称')}
          <input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button disabled={pending}>{t('保存')}</button>
      </form>
      <label className="privacy-switch-row">
        <span>{t('包含此人的照片设为私密')}</span>
        <input
          type="checkbox"
          checked={person.marksAssetsPrivate ?? false}
          disabled={pending}
          onChange={(event) => void onPrivacyChange(person, event.currentTarget.checked)}
        />
      </label>
      <p>{t('私密标签或私密人物任一命中，整张照片都会隐藏，包括合照。人物合并会保留私密规则。')}</p>
      <p>{t('识别可能漏检，敏感照片请同时手动添加私密标签。')}</p>
      <button type="button" onClick={() => onPerson(person.id)}>
        {t('查看此人物的照片')}
      </button>
      <div className="photo-group-grid">
        {faces.isPending && <p role="status">{t('正在加载照片…')}</p>}
        {faces.error && (
          <div role="alert">
            {faces.error.message}
            <button type="button" onClick={() => void faces.refetch()}>
              {t('重试')}
            </button>
          </div>
        )}
        {faces.data?.pages
          .flatMap((page) => page.faces)
          .map((face) => {
            const src = thumbnail(face.asset);
            return (
              <div key={face.id}>
                <button type="button" onClick={() => onOpen(face.asset)}>
                  {src && <img loading="lazy" src={src} alt={face.asset.displayName} />}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void perform(() => splitPhotoFace(face.id), true)}
                >
                  {t('这不是同一个人')}
                </button>
              </div>
            );
          })}
      </div>
      {faces.hasNextPage && (
        <button
          type="button"
          disabled={faces.isFetchingNextPage}
          onClick={() => void faces.fetchNextPage()}
        >
          {t('加载更多')}
        </button>
      )}
    </div>
  );
}
