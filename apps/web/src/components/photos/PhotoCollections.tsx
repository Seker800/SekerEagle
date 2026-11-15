import { observeAcceptedOperation } from '../../lib/accepted-operation';
import { createEagleQueryKeys } from '../eagle/eagle-query-keys';
import { PhotoPersonMergeSelection } from './PhotoPersonMergeSelection';
import { applyPhotoPersonMerge } from './photo-person-merge-cache';
import { usePhotoPeople } from './use-photo-people';
import { getDesktopCacheBridge } from '../../lib/media-resolver';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PhotoFaceImage, facePreview, representativeFace } from './PhotoFaceImage';
import { photoPersonLabel } from './photo-person-label';
import { PhotoPeopleReview } from './PhotoPeopleReview';
import { getEagleWorkspaceCache } from '../eagle/eagle-workspace-cache';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  batchPhotoFaces,
  scanPhotoPeople,
  listPhotoPersonFaces,
  renamePhotoPerson,
  getPhotoPeopleSummary,
  updatePhotoPersonPrivacy,
  type PhotoPerson,
} from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';

const NOOP_SUBSCRIBE = () => () => {};
const NOOP_SNAPSHOT = () => 0;

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
  const [view, setView] = useState<'NAMED' | 'ALL' | 'REVIEW'>('NAMED');
  const [pollUntil, setPollUntil] = useState(0);
  const [search, setSearch] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const changes = ownerId ? getEagleWorkspaceCache(queryClient, ownerId, 'PHOTO').operations : null;
  useSyncExternalStore(
    changes?.subscribe ?? NOOP_SUBSCRIBE,
    changes?.getSnapshot ?? NOOP_SNAPSHOT,
    changes?.getSnapshot ?? NOOP_SNAPSHOT,
  );
  const activeScan = changes?.entries.find(
    (entry) => entry.pending && entry.summary?.commandType === 'PHOTO_PEOPLE_SCAN',
  )?.summary;
  const scanning = Boolean(activeScan) || pollUntil > Date.now();
  useEffect(() => {
    if (!pollUntil) return;
    const timer = setTimeout(() => setPollUntil(0), Math.max(0, pollUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [pollUntil]);
  useEffect(() => {
    const timer = setTimeout(() => setPersonSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (selectedPerson) editorRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [selectedPerson]);
  const summary = useQuery({
    queryKey: createEagleQueryKeys(ownerId, 'PHOTO').photoPeopleSummaryScope(includePrivate),
    queryFn: getPhotoPeopleSummary,
    refetchInterval: scanning ? 5000 : false,
  });
  const people = usePhotoPeople(
    ownerId,
    includePrivate,
    view !== 'REVIEW',
    scanning,
    view === 'REVIEW' ? 'NAMED' : view,
    view === 'NAMED' ? personSearch : '',
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
    successMessage?: string,
  ) {
    if (actionPending.current) return false;
    actionPending.current = true;
    setError(null);
    setPending(true);
    try {
      const result = await action();
      const accepted = observeAcceptedOperation(queryClient, ownerId, 'PHOTO', result);
      if (changesPrivacy) {
        onPrivacyRulesChange();
        try {
          await getDesktopCacheBridge()?.clearCache();
        } catch {
          setError(t('隐私规则已保存，但桌面媒体缓存清理失败。'));
        }
      }
      if (accepted) {
        setFeedback(successMessage ?? t('任务已加入后台队列，可在任务中心查看进度。'));
        return true;
      }
      if (!changesPrivacy)
        await queryClient.invalidateQueries({
          queryKey: createEagleQueryKeys(ownerId, 'PHOTO').assetDetails,
        });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: createEagleQueryKeys(ownerId, 'PHOTO').photoPeople,
        }),
        summary.refetch(),
        ...(refreshReview
          ? [
              queryClient.invalidateQueries({
                queryKey: createEagleQueryKeys(ownerId, 'PHOTO').photoPersonReview,
              }),
            ]
          : []),
        queryClient.invalidateQueries({
          queryKey: createEagleQueryKeys(ownerId, 'PHOTO').photoPersonFaces,
        }),
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
      queryClient.invalidateQueries({
        queryKey: createEagleQueryKeys(ownerId, 'PHOTO').photoPeopleSummary,
      }),
      queryClient.invalidateQueries({
        queryKey: createEagleQueryKeys(ownerId, 'PHOTO').photoPersonFaces,
      }),
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
        <h2>{t('人物分组')}</h2>
        <div className="photo-collections-header-actions">
          <button
            type="button"
            disabled={pending || people.isFetching}
            onClick={() => {
              void people.refetch();
              void summary.refetch();
            }}
          >
            {t('刷新')}
          </button>
          <button
            type="button"
            disabled={
              pending ||
              people.isPending ||
              Boolean(people.error) ||
              Boolean(activeScan) ||
              people.data?.runtimeConfigured !== true
            }
            onClick={() => {
              void perform(
                async () => scanPhotoPeople(),
                false,
                true,
                t('已开始分析人物，可在任务中心查看进度。'),
              ).then((done) => {
                if (done) setPollUntil(Date.now() + 120_000);
              });
            }}
          >
            {activeScan ? t('正在分析人物…') : t('分析人物')}
          </button>
        </div>
      </div>
      {activeScan && (
        <p role="status">{t('正在分析人物，新的分组会陆续出现；可在任务中心查看进度。')}</p>
      )}
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
                ['NAMED', t('已命名分组')],
                ['REVIEW', t('待确认')],
                ['ALL', t('所有分组')],
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
                  : id === 'ALL' && summary.data
                    ? ` (${summary.data.named + summary.data.unnamed})`
                    : ''}
              </button>
            ))}
          </div>
          {view === 'NAMED' && (
            <input
              className="photo-person-search"
              type="search"
              aria-label={t('搜索已命名分组')}
              placeholder={t('搜索已命名分组')}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          )}
          {view !== 'REVIEW' && summary.data && summary.data.unnamed > 0 && (
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
              {view === 'ALL' && (
                <PhotoPersonMergeSelection
                  key={`${ownerId}:${includePrivate}:${scopeRevision}:${selectionEpoch}`}
                  ownerId={ownerId}
                  includePrivate={includePrivate}
                  scopeRevision={scopeRevision}
                  selected={Object.values(directorySelection).filter((person) =>
                    people.data?.people.some((visible) => visible.id === person.id),
                  )}
                  onClear={clearDirectorySelection}
                  onPendingChange={setPending}
                  onConflict={() =>
                    queryClient.invalidateQueries({
                      queryKey: createEagleQueryKeys(ownerId, 'PHOTO').photoPeople,
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
                {people.data?.people.map((person) => {
                  const face = representativeFace(person),
                    src = face ? thumbnail(face.asset) : null;
                  return (
                    <article key={person.id} className="photo-person-selection-card">
                      {view === 'ALL' && (
                        <input
                          type="checkbox"
                          aria-label={t('选择分组 {{value1}}', {
                            value1: photoPersonLabel(person),
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
                        <strong>{photoPersonLabel(person)}</strong>
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
                <div ref={editorRef}>
                  <PersonEditor
                    key={selectedPerson}
                    includePrivate={includePrivate}
                    person={people.data.people.find((person) => person.id === selectedPerson)!}
                    pending={pending}
                    onClose={() => setSelectedPerson(null)}
                    perform={(action, changesPrivacy) => perform(action, changesPrivacy)}
                    onPrivacyChange={(person, checked) =>
                      perform(async () => {
                        const result = await updatePhotoPersonPrivacy(person, checked);
                        if (observeAcceptedOperation(queryClient, ownerId, 'PHOTO', result))
                          return result;
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
                </div>
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
                {view === 'NAMED' && personSearch
                  ? t('没有匹配的已命名分组。')
                  : view === 'NAMED'
                    ? t(
                        '还没有已命名分组。可先点「分析人物」，再到「所有分组」命名，或从「待确认」开始合并。',
                      )
                    : t('还没有人物分组。点右上角「分析人物」开始第一次分析。')}
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
  onClose,
}: {
  person: PhotoPerson;
  includePrivate: boolean;
  pending: boolean;
  perform: (action: () => Promise<unknown>, changesPrivacy?: boolean) => Promise<boolean>;
  onPrivacyChange: (person: PhotoPerson, checked: boolean) => Promise<boolean>;
  onPerson: (id: string) => void;
  onOpen: (asset: EagleAssetListItem) => void;
  thumbnail: (asset: EagleAssetListItem) => string | null;
  onClose: () => void;
}) {
  const { ownerId } = useLibraryWorkspace();
  const faces = useInfiniteQuery({
    queryKey: createEagleQueryKeys(ownerId, 'PHOTO').photoPersonFaceList(includePrivate, person.id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listPhotoPersonFaces(person.id, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30000,
  });
  const [name, setName] = useState(person.name ?? '');
  const [selectedFaces, setSelectedFaces] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<'SPLIT' | 'REMOVE' | null>(null);
  const faceRows = faces.data?.pages.flatMap((page) => page.faces) ?? [];
  function toggleFace(id: string, checked: boolean) {
    setArmed(null);
    setSelectedFaces((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function runFaceBatch(action: 'SPLIT' | 'REMOVE') {
    if (!selectedFaces.size || pending) return;
    if (armed !== action) {
      setArmed(action);
      return;
    }
    setArmed(null);
    const ids = [...selectedFaces];
    void perform(() => batchPhotoFaces(ids, action), true).then((done) => {
      if (done) setSelectedFaces(new Set());
    });
  }
  return (
    <div className="photo-person-editor">
      <div className="photo-person-editor-header">
        <h3>{photoPersonLabel(person, true)}</h3>
        <button type="button" onClick={onClose}>
          {t('关闭')}
        </button>
      </div>
      {pending && <p role="status">{t('正在保存…')}</p>}
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
      <div className="photo-face-batch-actions">
        <span>{t('已选 {{value1}} 张人脸', { value1: selectedFaces.size })}</span>
        <button
          type="button"
          disabled={!faceRows.length}
          onClick={() => setSelectedFaces(new Set(faceRows.map((face) => face.id)))}
        >
          {t('全选本页')}
        </button>
        <button
          type="button"
          disabled={!selectedFaces.size}
          onClick={() => {
            setArmed(null);
            setSelectedFaces(new Set());
          }}
        >
          {t('清除选择')}
        </button>
        <button
          type="button"
          disabled={!selectedFaces.size || pending}
          onClick={() => runFaceBatch('SPLIT')}
        >
          {armed === 'SPLIT' ? t('确认分开所选人脸') : t('分开为不同人物')}
        </button>
        <button
          type="button"
          disabled={!selectedFaces.size || pending}
          onClick={() => runFaceBatch('REMOVE')}
        >
          {armed === 'REMOVE' ? t('确认不是人脸') : t('不是人脸')}
        </button>
      </div>
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
        {faceRows.map((face) => {
          const src = thumbnail(face.asset);
          return (
            <div key={face.id} className="photo-face-select-card">
              <input
                type="checkbox"
                aria-label={t('选择人脸 {{value1}}', { value1: face.asset.displayName })}
                checked={selectedFaces.has(face.id)}
                disabled={pending}
                onChange={(event) => toggleFace(face.id, event.currentTarget.checked)}
              />
              <button type="button" onClick={() => onOpen(face.asset)}>
                {src && <PhotoFaceImage face={face} url={thumbnail} alt={face.asset.displayName} />}
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
