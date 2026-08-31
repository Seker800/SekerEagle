import { getLocale, t } from '../../i18n';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { IconCheck, IconTags, IconTrash } from '@tabler/icons-react';
import { listEagleManualTags, type EagleManualTag } from '../../lib/eagle-api';
import {
  getVectorThumbnailUrl,
  listEagleTagDistanceAssets,
  listEagleUnclassifiedAssets,
  listEagleVectorSuggestions,
  listEagleVectorTags,
  rebuildEagleVectorTag,
  reviewEagleVectorSuggestions,
  scanUnclassifiedEagleSuggestions,
  setEagleVectorTagEnabled,
  type EagleTagDistanceAsset,
  type EagleUnclassifiedAsset,
  type EagleVectorSuggestion,
  type EagleVectorTag,
} from '../../lib/eagle-vector-api';
import { EagleBatchTagPicker } from './EagleBatchTagPicker';
import { searchAndSortEagleTags } from './eagle-tag-index';
import { applyEagleSelection, type EagleSelectionGesture } from './eagle-selection';
import styles from './EagleVectorWorkspace.module.css';
export type EagleVectorWorkspaceView = 'REVIEW' | 'TAGS' | 'UNCLASSIFIED';
type View = EagleVectorWorkspaceView | 'DISTANCE';
type SimilaritySort = 'LOW_FIRST' | 'HIGH_FIRST';
interface EagleVectorWorkspaceProps {
  view?: EagleVectorWorkspaceView;
  manualTags?: EagleManualTag[];
  onAssignManualTags?: (assetIds: string[], tagIds: string[]) => Promise<void>;
  onChangeManualTags?: (input: {
    assetIds: string[];
    addTagIds: string[];
    removeTagIds: string[];
  }) => Promise<void>;
  onCreateManualTag?: (name: string) => Promise<EagleManualTag>;
  onTrashAssets?: (assetIds: string[]) => Promise<void>;
}
export function EagleVectorWorkspace({
  view: controlledView,
  manualTags: providedManualTags,
  onAssignManualTags,
  onChangeManualTags,
  onCreateManualTag,
  onTrashAssets,
}: EagleVectorWorkspaceProps = {}) {
  const [tags, setTags] = useState<EagleVectorTag[]>([]);
  const [suggestions, setSuggestions] = useState<EagleVectorSuggestion[]>([]);
  const [unclassified, setUnclassified] = useState<EagleUnclassifiedAsset[]>([]);
  const [distances, setDistances] = useState<EagleTagDistanceAsset[]>([]);
  const [unclassifiedCursor, setUnclassifiedCursor] = useState<string | null>(null);
  const [distanceCursor, setDistanceCursor] = useState<string | null>(null);
  const [view, setView] = useState<View>(controlledView ?? 'REVIEW');
  const [tagFilter, setTagFilter] = useState('');
  const [distanceTag, setDistanceTag] = useState<EagleVectorTag | null>(null);
  const [similaritySort, setSimilaritySort] = useState<SimilaritySort>('LOW_FIRST');
  const [selected, setSelected] = useState<string[]>([]);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null);
  const [isBatchSelection, setIsBatchSelection] = useState(false);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const distanceRequestIdRef = useRef(0);
  const [search, setSearch] = useState('');
  const [managedTagSearch, setManagedTagSearch] = useState('');
  const [loadedManualTags, setLoadedManualTags] = useState<EagleManualTag[]>([]);
  const [loadingManualTags, setLoadingManualTags] = useState(false);
  const [tagPickerTarget, setTagPickerTarget] = useState<{
    assetIds: string[];
    suggestionIds: string[];
    removeTagIds: string[];
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    itemIds: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const clearSelection = useCallback(() => {
    setSelected([]);
    setActiveSelectionId(null);
    setIsBatchSelection(false);
    selectionAnchorIdRef.current = null;
  }, []);
  useEffect(() => {
    if (!controlledView) return;
    setView(controlledView);
    setDistanceTag(null);
    clearSelection();
  }, [clearSelection, controlledView]);
  const reload = useCallback(async () => {
    setError('');
    try {
      const [nextTags, nextSuggestions, nextUnclassified] = await Promise.all([
        view === 'REVIEW' || view === 'TAGS' || view === 'DISTANCE'
          ? listEagleVectorTags()
          : Promise.resolve(null),
        view === 'REVIEW'
          ? listEagleVectorSuggestions(tagFilter || undefined)
          : Promise.resolve(null),
        view === 'UNCLASSIFIED' ? listEagleUnclassifiedAssets() : Promise.resolve(null),
      ]);
      if (nextTags) setTags(nextTags);
      if (nextSuggestions) {
        setSuggestions(nextSuggestions.items);
      }
      if (nextUnclassified) {
        setUnclassified(nextUnclassified.items);
        setUnclassifiedCursor(nextUnclassified.nextCursor);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('读取向量处理状态失败'));
    }
  }, [tagFilter, view]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setContextMenu(null);
      clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 10000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [reload]);
  useEffect(() => {
    if ((view !== 'TAGS' && view !== 'DISTANCE') || providedManualTags) return;
    let cancelled = false;
    setLoadingManualTags(true);
    void listEagleManualTags('')
      .then((results) => {
        if (!cancelled) setLoadedManualTags(results);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('读取人工标签失败'));
      })
      .finally(() => {
        if (!cancelled) setLoadingManualTags(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providedManualTags, view]);
  const manualTags = providedManualTags ?? loadedManualTags;
  const changeManualTags = useMemo(
    () =>
      onChangeManualTags ??
      (onAssignManualTags
        ? (input: { assetIds: string[]; addTagIds: string[] }) =>
            onAssignManualTags(input.assetIds, input.addTagIds)
        : null),
    [onAssignManualTags, onChangeManualTags],
  );
  const reviewTags = useMemo(
    () =>
      tags
        .filter((tag) => tag.recommendationEnabled && tag.currentSnapshotId)
        .sort(
          (left, right) =>
            right.pendingSuggestionCount - left.pendingSuggestionCount ||
            left.name.localeCompare(right.name, getLocale()),
        ),
    [tags],
  );
  const reviewSuggestionCount = reviewTags.reduce(
    (total, tag) => total + tag.pendingSuggestionCount,
    0,
  );
  const orderedSuggestions = useMemo(
    () =>
      [...suggestions].sort(
        (left, right) =>
          right.score - left.score ||
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      ),
    [suggestions],
  );
  const orderedSuggestionIds = useMemo(
    () => orderedSuggestions.map((suggestion) => suggestion.id),
    [orderedSuggestions],
  );
  const availableTags = useMemo(() => {
    const enabledIds = new Set(tags.map((tag) => tag.id));
    return searchAndSortEagleTags(
      manualTags.filter((tag) => !enabledIds.has(tag.id)),
      search,
    );
  }, [manualTags, search, tags]);
  const visibleManagedTags = useMemo(() => {
    const query = managedTagSearch.normalize('NFKC').trim().toLocaleLowerCase(getLocale());
    if (!query) return tags;
    return tags.filter((tag) =>
      tag.name.normalize('NFKC').toLocaleLowerCase(getLocale()).includes(query),
    );
  }, [managedTagSearch, tags]);
  const distanceAssetIds = useMemo(() => distances.map((item) => item.assetId), [distances]);
  const act = async <T,>(action: () => Promise<T>, message: string | ((result: T) => string)) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      setNotice(typeof message === 'function' ? message(result) : message);
      await reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('操作失败'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const addRecommendationTag = async (tag: Pick<EagleManualTag, 'id' | 'name'>) => {
    const added = await act(
      () => setEagleVectorTagEnabled(tag.id, true),
      t('已添加“{{value1}}”参与推荐', {
        value1: tag.name,
      }),
    );
    if (added) {
      setSearch('');
    }
  };
  const replaceDistanceResults = async (tagId: string, sort: SimilaritySort) => {
    const requestId = ++distanceRequestIdRef.current;
    const result = await listEagleTagDistanceAssets(tagId, toDistanceDirection(sort));
    if (requestId !== distanceRequestIdRef.current) return false;
    setDistances(sortDistanceItems(result.items, sort));
    setDistanceCursor(result.nextCursor);
    return true;
  };
  const openDistance = async (tag: EagleVectorTag) => {
    setBusy(true);
    setError('');
    try {
      const loaded = await replaceDistanceResults(tag.id, similaritySort);
      if (!loaded) return;
      setDistanceTag(tag);
      setView('DISTANCE');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('读取标签距离失败'));
    } finally {
      setBusy(false);
    }
  };
  const review = async (ids: string[], action: 'ACCEPT' | 'REJECT') => {
    const reviewed = await act(
      () => reviewEagleVectorSuggestions(ids, action),
      action === 'ACCEPT'
        ? t('已确认 {{value1}} 条人工标签建议', {
            value1: ids.length,
          })
        : t('已拒绝 {{value1}} 条建议', {
            value1: ids.length,
          }),
    );
    if (reviewed) clearSelection();
  };
  const selectItem = (itemId: string, orderedIds: string[], gesture: EagleSelectionGesture) => {
    const nextSelection = applyEagleSelection({
      orderedIds,
      selectedIds: selected,
      activeId: activeSelectionId,
      anchorId: selectionAnchorIdRef.current,
      clickedId: itemId,
      gesture,
    });
    setSelected(nextSelection.selectedIds);
    setActiveSelectionId(nextSelection.activeId);
    setIsBatchSelection(nextSelection.isBatchSelection);
    selectionAnchorIdRef.current = nextSelection.anchorId;
  };
  const getTagPickerTarget = (itemIds: string[]) => {
    if (view === 'REVIEW') {
      const suggestionIds = new Set(itemIds);
      return {
        suggestionIds: itemIds,
        assetIds: suggestions
          .filter((suggestion) => suggestionIds.has(suggestion.id))
          .map((suggestion) => suggestion.asset.id),
      };
    }
    return { suggestionIds: [], assetIds: itemIds };
  };
  const openTagPicker = (itemIds: string[], removeTagIds: string[] = []) => {
    if (!changeManualTags || itemIds.length === 0) return;
    setContextMenu(null);
    setTagPickerTarget({ ...getTagPickerTarget(itemIds), removeTagIds });
  };
  const refreshDistance = async () => {
    if (!distanceTag) return;
    await replaceDistanceResults(distanceTag.id, similaritySort);
  };
  const changeSimilaritySort = async (nextSort: SimilaritySort) => {
    if (!distanceTag) return;
    setSimilaritySort(nextSort);
    clearSelection();
    setBusy(true);
    setError('');
    try {
      await replaceDistanceResults(distanceTag.id, nextSort);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('读取标签相似度失败'));
    } finally {
      setBusy(false);
    }
  };
  const changeDistanceTags = async (input: {
    assetIds: string[];
    addTagIds: string[];
    removeTagIds: string[];
  }) => {
    if (!changeManualTags) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await changeManualTags(input);
      const enabledTagIds = new Set(
        tags.filter((tag) => tag.recommendationEnabled).map((tag) => tag.id),
      );
      const rebuildTagIds = [...new Set([...input.removeTagIds, ...input.addTagIds])].filter(
        (tagId) => enabledTagIds.has(tagId),
      );
      const rebuildResults = await Promise.allSettled(
        rebuildTagIds.map((tagId) => rebuildEagleVectorTag(tagId)),
      );
      const rebuiltCount = rebuildResults.filter((result) => result.status === 'fulfilled').length;
      const centerNotice = !rebuildTagIds.length
        ? ''
        : rebuiltCount
          ? t('，已提交 {{value1}} 个标签中心刷新', {
              value1: rebuiltCount,
            })
          : t('；标签中心暂未刷新，请保留基础图片后手动生成');
      setNotice(
        input.removeTagIds.length && input.addTagIds.length
          ? t('已移动 {{value1}} 项素材{{value2}}', {
              value1: input.assetIds.length,
              value2: centerNotice,
            })
          : input.removeTagIds.length
            ? t('已从“{{value1}}”移除 {{value2}} 项素材{{value3}}', {
                value1: distanceTag?.name ?? t('当前标签'),
                value2: input.assetIds.length,
                value3: centerNotice,
              })
            : t('已为 {{value1}} 项素材添加人工标签{{value2}}', {
                value1: input.assetIds.length,
                value2: centerNotice,
              }),
      );
      setTagPickerTarget(null);
      clearSelection();
      await Promise.all([reload(), refreshDistance()]);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('修改人工标签失败'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const assignManualTags = async (tagIds: string[]) => {
    if (!tagPickerTarget || !changeManualTags) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (tagPickerTarget.suggestionIds.length) {
        await reviewEagleVectorSuggestions(tagPickerTarget.suggestionIds, 'REJECT');
      }
      if (view === 'DISTANCE') {
        await changeDistanceTags({
          assetIds: tagPickerTarget.assetIds,
          addTagIds: tagIds,
          removeTagIds: tagPickerTarget.removeTagIds,
        });
        return;
      }
      await changeManualTags({
        assetIds: tagPickerTarget.assetIds,
        addTagIds: tagIds,
        removeTagIds: tagPickerTarget.removeTagIds,
      });
      setNotice(
        t('已为 {{value1}} 项素材添加人工标签', {
          value1: tagPickerTarget.assetIds.length,
        }),
      );
      setTagPickerTarget(null);
      clearSelection();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('添加人工标签失败'));
    } finally {
      setBusy(false);
    }
  };
  const trashItems = async (itemIds: string[]) => {
    if (!onTrashAssets) return;
    const { assetIds } = getTagPickerTarget(itemIds);
    const trashed = await act(
      () => onTrashAssets(assetIds),
      t('已将 {{value1}} 项素材移到回收站', {
        value1: assetIds.length,
      }),
    );
    if (trashed) {
      setContextMenu(null);
      clearSelection();
    }
  };
  const openContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    itemId: string,
    orderedIds: string[],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const itemIds = selected.includes(itemId) ? selected : [itemId];
    if (!selected.includes(itemId)) selectItem(itemId, orderedIds, 'single');
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 184)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 48)),
      itemIds,
    });
  };
  const pageCopy =
    view === 'TAGS' || view === 'DISTANCE'
      ? {
          eyebrow: t('推荐语义'),
          title:
            view === 'DISTANCE'
              ? t('相似度检查 · {{value1}}', {
                  value1: distanceTag?.name ?? '',
                })
              : t('标签推荐设置'),
          description: t('选择哪些人工标签参与推荐，并管理每个标签的向量中心。'),
        }
      : view === 'UNCLASSIFIED'
        ? {
            eyebrow: t('人工归类'),
            title: t('待手动分类'),
            description: t('这些素材暂时没有可靠推荐，请直接添加一个或多个人工标签。'),
          }
        : {
            eyebrow: t('人工标签建议'),
            title: t('智能标签确认'),
            description: t('确认可靠建议，拒绝不正确的结果，或为素材指定其他人工标签。'),
          };
  return (
    <section
      className={styles.workspace}
      aria-label={pageCopy.title}
      onClick={() => setContextMenu(null)}
    >
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>{pageCopy.eyebrow}</span>
        <h2>{pageCopy.title}</h2>
        <p>{pageCopy.description}</p>
      </header>

      {view === 'REVIEW' ? (
        <div className={styles.boundary}>
          <strong>{t('只写入人工标签')}</strong>
          <span>{t('这里审核的是已有人工标签的向量推荐，不会写入 AI 自动标签。')}</span>
        </div>
      ) : null}

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      ) : null}

      {view === 'REVIEW' ? (
        <section className={styles.panel} aria-label={t('智能标签确认')}>
          <div className={styles.tagFilters} role="group" aria-label={t('推荐标签筛选')}>
            <span>{t('推荐标签')}</span>
            <div className={styles.tagFilterOptions}>
              <button
                type="button"
                className={!tagFilter ? styles.tagFilterActive : undefined}
                aria-pressed={!tagFilter}
                onClick={() => {
                  clearSelection();
                  setTagFilter('');
                }}
              >
                <span>{t('全部建议')}</span>
                <strong>{reviewSuggestionCount}</strong>
              </button>
              {reviewTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className={tagFilter === tag.id ? styles.tagFilterActive : undefined}
                  aria-pressed={tagFilter === tag.id}
                  onClick={() => {
                    clearSelection();
                    setTagFilter(tag.id);
                  }}
                >
                  <span>{tag.name}</span>
                  <strong>{tag.pendingSuggestionCount}</strong>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.toolbar}>
            <span className={styles.selectionCount}>
              {t('已选择') + ' '}
              {selected.length}
              {' ' + t('项')}
            </span>
            <button
              className={styles.primaryAction}
              type="button"
              disabled={!orderedSuggestionIds.length || busy}
              onClick={() => void review(orderedSuggestionIds, 'ACCEPT')}
            >
              {' ' + t('本页全部确认') + ' '}
            </button>
            <button
              type="button"
              disabled={!selected.length || busy}
              onClick={() => void review(selected, 'ACCEPT')}
            >
              {' ' + t('批量确认') + ' '}
            </button>
            <button
              type="button"
              disabled={!selected.length || busy}
              onClick={() => void review(selected, 'REJECT')}
            >
              {' ' + t('批量拒绝') + ' '}
            </button>
            <button
              type="button"
              disabled={!selected.length || busy || !changeManualTags}
              onClick={() => openTagPicker(selected)}
            >
              {' ' + t('指定其他标签') + ' '}
            </button>
          </div>
          <AssetGrid ariaLabel={t('待确认的智能标签建议')} onClear={clearSelection}>
            {orderedSuggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                selected={selected.includes(suggestion.id)}
                batchSelection={isBatchSelection}
                onSelect={(gesture) => selectItem(suggestion.id, orderedSuggestionIds, gesture)}
                onReview={(action) => void review([suggestion.id], action)}
                onContextMenu={(event) =>
                  openContextMenu(event, suggestion.id, orderedSuggestionIds)
                }
                disabled={busy}
              />
            ))}
          </AssetGrid>
          {!suggestions.length ? <Empty text={t('当前没有待确认的人工标签建议。')} /> : null}
        </section>
      ) : null}

      {view === 'TAGS' ? (
        <section className={styles.panel} aria-label={t('推荐标签设置')}>
          <div className={styles.tagSearch}>
            <label htmlFor="vector-tag-search">{t('添加推荐标签')}</label>
            <input
              id="vector-tag-search"
              aria-label={t('搜索可添加的人工标签')}
              autoComplete="off"
              placeholder={t('搜索名称、拼音或首字母')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <small>{t('尚未参与推荐的标签；同等匹配下，素材数量多的优先。')}</small>
            <div className={styles.tagSearchResults} aria-label={t('可添加的标签')}>
              {loadingManualTags ? (
                <span className={styles.searchHint}>{t('正在读取标签…')}</span>
              ) : null}
              {!loadingManualTags && !availableTags.length ? (
                <span className={styles.searchHint}>
                  {search.trim() ? t('没有找到可添加的标签。') : t('没有尚未参与推荐的标签。')}
                </span>
              ) : null}
              {!loadingManualTags && availableTags.length ? (
                <div
                  className={styles.tagCandidateGrid}
                  role="list"
                  aria-label={t('可添加的推荐标签卡片')}
                >
                  {availableTags.map(({ tag }) => (
                    <article className={styles.tagCandidate} role="listitem" key={tag.id}>
                      <div className={styles.tagCandidateIdentity}>
                        <span
                          className={styles.tagDot}
                          style={{ background: tag.color ?? '#777' }}
                        />
                        <h3>{tag.name}</h3>
                      </div>
                      <p>
                        {tag.assetCount}
                        {' ' + t('张图片')}
                      </p>
                      <button
                        type="button"
                        aria-label={t('添加{{value1}}到推荐', {
                          value1: tag.name,
                        })}
                        disabled={busy}
                        onClick={() => void addRecommendationTag(tag)}
                      >
                        {' ' + t('添加') + ' '}
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className={styles.sectionHeading}>
            <strong>{t('参与推荐')}</strong>
            <span>
              {visibleManagedTags.length} / {tags.length}
              {' ' + t('个标签') + ' '}
            </span>
          </div>
          <div className={styles.managedTagToolbar}>
            <input
              type="search"
              aria-label={t('搜索参与推荐的标签')}
              placeholder={t('搜索已参与推荐的标签')}
              value={managedTagSearch}
              onChange={(event) => setManagedTagSearch(event.target.value)}
            />
          </div>
          {tags.length ? (
            <>
              <div className={styles.tagGrid} role="list" aria-label={t('参与推荐的标签卡片')}>
                {visibleManagedTags.map((tag) => (
                  <RecommendationTagCard
                    key={tag.id}
                    tag={tag}
                    busy={busy}
                    onRebuild={() =>
                      void act(
                        () => rebuildEagleVectorTag(tag.id),
                        t('“{{value1}}”中心已进入后台构建', {
                          value1: tag.name,
                        }),
                      )
                    }
                    onInspect={() => void openDistance(tag)}
                    onDisable={() =>
                      void act(
                        () => setEagleVectorTagEnabled(tag.id, false),
                        t('已将“{{value1}}”移出推荐', {
                          value1: tag.name,
                        }),
                      )
                    }
                  />
                ))}
              </div>
              {!visibleManagedTags.length ? <Empty text={t('没有匹配的推荐标签。')} /> : null}
            </>
          ) : (
            <Empty text={t('还没有参与推荐的标签，请从上方搜索并添加。')} />
          )}
        </section>
      ) : null}

      {view === 'UNCLASSIFIED' ? (
        <section className={styles.panel} aria-label={t('待手动分类')}>
          <div className={styles.toolbar}>
            <span className={styles.selectionCount}>
              {t('已选择') + ' '}
              {selected.length}
              {' ' + t('项')}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(scanUnclassifiedEagleSuggestions, ({ scanned, matched }) =>
                  t('已扫描 {{value1}} 张无标签图片，新生成 {{value2}} 条建议', {
                    value1: scanned,
                    value2: matched,
                  }),
                )
              }
            >
              {' ' + t('扫描无标签图片') + ' '}
            </button>
            <button
              type="button"
              disabled={!selected.length || busy || !changeManualTags}
              onClick={() => openTagPicker(selected)}
            >
              {' ' + t('添加人工标签') + ' '}
            </button>
          </div>
          <p className={styles.explainer}>
            {' ' +
              t(
                '可能原因包括向量仍在处理、相似度不足，或当前没有可用的标签中心。选择素材后可直接完成归类。',
              ) +
              ' '}
          </p>
          <AssetGrid ariaLabel={t('待手动分类的素材')} onClear={clearSelection}>
            {unclassified.map((asset) => (
              <UnclassifiedCard
                key={asset.id}
                asset={asset}
                selected={selected.includes(asset.id)}
                batchSelection={isBatchSelection}
                onSelect={(gesture) =>
                  selectItem(
                    asset.id,
                    unclassified.map((item) => item.id),
                    gesture,
                  )
                }
                onContextMenu={(event) =>
                  openContextMenu(
                    event,
                    asset.id,
                    unclassified.map((item) => item.id),
                  )
                }
              />
            ))}
          </AssetGrid>
          {!unclassified.length ? <Empty text={t('当前没有遗漏的未分类图片。')} /> : null}
          {unclassifiedCursor ? (
            <LoadMore
              disabled={busy}
              onClick={async () => {
                const result = await listEagleUnclassifiedAssets(unclassifiedCursor);
                setUnclassified((current) => [...current, ...result.items]);
                setUnclassifiedCursor(result.nextCursor);
              }}
            />
          ) : null}
        </section>
      ) : null}

      {view === 'DISTANCE' && distanceTag ? (
        <section className={styles.panel} aria-label={t('标签图片相似度检查')}>
          <div className={styles.toolbar}>
            <button
              type="button"
              onClick={() => {
                setView('TAGS');
                setDistanceTag(null);
              }}
            >
              {' ' + t('返回标签推荐设置') + ' '}
            </button>
            <strong>{distanceTag.name}</strong>
            <span className={styles.selectionCount}>
              {t('已选择') + ' '}
              {selected.length}
              {' ' + t('项')}
            </span>
            <button
              type="button"
              disabled={!selected.length || busy || !changeManualTags}
              onClick={() =>
                void changeDistanceTags({
                  assetIds: selected,
                  addTagIds: [],
                  removeTagIds: [distanceTag.id],
                })
              }
            >
              {' ' + t('从“')}
              {distanceTag.name}
              {t('”移除') + ' '}
            </button>
            <button
              type="button"
              disabled={!selected.length || busy || !changeManualTags}
              onClick={() => openTagPicker(selected, [distanceTag.id])}
            >
              {' ' + t('移动到其他标签') + ' '}
            </button>
            <button
              type="button"
              disabled={!selected.length || busy || !changeManualTags}
              onClick={() => openTagPicker(selected)}
            >
              {' ' + t('添加其他标签') + ' '}
            </button>
            <label>
              {' ' + t('排序') + ' '}
              <select
                value={similaritySort}
                onChange={(event) => {
                  const nextSort = event.target.value as SimilaritySort;
                  void changeSimilaritySort(nextSort);
                }}
              >
                <option value="LOW_FIRST">{t('相似度从低到高')}</option>
                <option value="HIGH_FIRST">{t('相似度从高到低')}</option>
              </select>
            </label>
          </div>
          <AssetGrid
            ariaLabel={t('{{value1}}标签的成员相似度图片', {
              value1: distanceTag.name,
            })}
            onClear={clearSelection}
          >
            {distances.map((item) => (
              <DistanceCard
                key={item.assetId}
                item={item}
                selected={selected.includes(item.assetId)}
                batchSelection={isBatchSelection}
                onSelect={(gesture) => selectItem(item.assetId, distanceAssetIds, gesture)}
              />
            ))}
          </AssetGrid>
          {!distances.length ? <Empty text={t('该标签暂时没有可用的成员距离。')} /> : null}
          {distanceCursor ? (
            <LoadMore
              disabled={busy}
              onClick={async () => {
                const result = await listEagleTagDistanceAssets(
                  distanceTag.id,
                  toDistanceDirection(similaritySort),
                  distanceCursor,
                );
                setDistances((current) =>
                  sortDistanceItems([...current, ...result.items], similaritySort),
                );
                setDistanceCursor(result.nextCursor);
              }}
            />
          ) : null}
        </section>
      ) : null}

      {contextMenu && (changeManualTags || onTrashAssets) ? (
        <div
          className={styles.contextMenu}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {changeManualTags ? (
            <button
              type="button"
              role="menuitem"
              aria-label={view === 'REVIEW' ? t('指定其他标签') : t('添加人工标签')}
              onClick={() => openTagPicker(contextMenu.itemIds)}
            >
              <IconTags size={15} />
              {view === 'REVIEW' ? t('指定其他标签') : t('添加人工标签')}
            </button>
          ) : null}
          {onTrashAssets ? (
            <button
              type="button"
              role="menuitem"
              aria-label={t('删除（移到回收站）')}
              onClick={() => void trashItems(contextMenu.itemIds)}
            >
              <IconTrash size={15} />
              {' ' + t('删除（移到回收站）') + ' '}
            </button>
          ) : null}
        </div>
      ) : null}

      {tagPickerTarget ? (
        <EagleBatchTagPicker
          assetCount={tagPickerTarget.assetIds.length}
          tags={
            view === 'DISTANCE' && distanceTag
              ? manualTags.filter((tag) => tag.id !== distanceTag.id)
              : manualTags
          }
          pending={busy}
          error={error || undefined}
          onCreate={onCreateManualTag}
          onClose={() => setTagPickerTarget(null)}
          onApply={(tagIds) => void assignManualTags(tagIds)}
        />
      ) : null}
    </section>
  );
}
function RecommendationTagCard({
  tag,
  busy,
  onRebuild,
  onInspect,
  onDisable,
}: {
  tag: EagleVectorTag;
  busy: boolean;
  onRebuild: () => void;
  onInspect: () => void;
  onDisable: () => void;
}) {
  const status = tag.activeBuild
    ? t('正在构建中心')
    : tag.currentSnapshot
      ? t('推荐正常')
      : tag.assetCount
        ? t('需要生成中心')
        : t('需要基础图片');
  const canRebuild = !busy && tag.recommendationEnabled && tag.assetCount > 0 && !tag.activeBuild;
  return (
    <article
      className={styles.tagCard}
      role="listitem"
      aria-label={t('{{value1}}推荐标签', {
        value1: tag.name,
      })}
    >
      <div className={styles.tagCardHeader}>
        <div className={styles.tagIdentity}>
          <span className={styles.tagDot} style={{ background: tag.color ?? '#777' }} />
          <div>
            <h3>{tag.name}</h3>
            <span
              className={
                tag.currentSnapshot && !tag.activeBuild ? styles.tagReady : styles.tagPending
              }
            >
              {status}
            </span>
          </div>
        </div>
        <span className={styles.tagVersion}>
          {tag.currentSnapshot
            ? t('中心版本 v{{value1}}', {
                value1: tag.currentSnapshot.version,
              })
            : t('尚未建立中心')}
        </span>
      </div>
      <div className={styles.tagMetrics}>
        <div className={styles.tagPrimaryMetric} aria-label={t('基础图片数量')}>
          <strong>{tag.assetCount}</strong>
          <span>{t('基础图片')}</span>
        </div>
        <div className={styles.tagSecondaryMetrics}>
          <div aria-label={t('向量中心数量')}>
            <strong>{tag.currentSnapshot?.centerCount ?? 0}</strong>
            <span>{t('向量中心')}</span>
          </div>
          <div aria-label={t('待确认建议数量')}>
            <strong>{tag.pendingSuggestionCount}</strong>
            <span>{t('待确认')}</span>
          </div>
        </div>
      </div>
      <div className={styles.tagCardActions}>
        {tag.currentSnapshot ? (
          <button
            className={styles.tagPrimaryAction}
            type="button"
            aria-label={t('检查{{value1}}的图片距离', {
              value1: tag.name,
            })}
            disabled={busy}
            onClick={onInspect}
          >
            {' ' + t('检查图片距离') + ' '}
          </button>
        ) : (
          <button
            className={styles.tagPrimaryAction}
            type="button"
            aria-label={
              tag.activeBuild
                ? t('{{value1}}推荐中心正在构建', {
                    value1: tag.name,
                  })
                : t('生成{{value1}}推荐中心', {
                    value1: tag.name,
                  })
            }
            disabled={!canRebuild}
            onClick={onRebuild}
          >
            {tag.activeBuild ? t('正在构建中心…') : t('生成推荐中心')}
          </button>
        )}
        {tag.currentSnapshot ? (
          <button
            className={styles.tagSecondaryAction}
            type="button"
            aria-label={t('刷新{{value1}}推荐中心', {
              value1: tag.name,
            })}
            disabled={!canRebuild}
            onClick={onRebuild}
          >
            {tag.activeBuild ? t('构建中…') : t('刷新中心')}
          </button>
        ) : null}
        <button
          className={styles.tagRemoveAction}
          type="button"
          aria-label={t('将{{value1}}移出推荐', {
            value1: tag.name,
          })}
          disabled={busy}
          onClick={onDisable}
        >
          {' ' + t('移出推荐') + ' '}
        </button>
      </div>
    </article>
  );
}
function DistanceCard({
  item,
  selected,
  batchSelection,
  onSelect,
}: {
  item: EagleTagDistanceAsset;
  selected: boolean;
  batchSelection: boolean;
  onSelect: (gesture: EagleSelectionGesture) => void;
}) {
  const similarity = formatSimilarity(item.distance);
  return (
    <article className={`${styles.assetCard} ${selected ? styles.assetCardSelected : ''}`}>
      <button
        className={styles.assetSelectionTarget}
        type="button"
        aria-label={t('选择 {{value1}}，相似度 {{value2}}', {
          value1: item.asset.displayName,
          value2: similarity,
        })}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(getSelectionGesture(event));
        }}
      >
        <Preview asset={item.asset} />
        {batchSelection ? <SelectionMark selected={selected} /> : null}
        <div className={styles.similarityInfo}>
          <span>
            {t('与“')}
            {item.prototypeRank + 1}
            {' ' + t('号中心”')}
          </span>
          <strong>
            {t('相似度') + ' '}
            {similarity}
          </strong>
        </div>
        <span className={styles.assetFileName} title={item.asset.displayName}>
          {item.asset.displayName}
        </span>
      </button>
    </article>
  );
}
function toDistanceDirection(sort: SimilaritySort): 'ASC' | 'DESC' {
  return sort === 'LOW_FIRST' ? 'DESC' : 'ASC';
}
function sortDistanceItems(items: EagleTagDistanceAsset[], sort: SimilaritySort) {
  return [...items].sort((left, right) => {
    const distanceOrder =
      sort === 'LOW_FIRST' ? right.distance - left.distance : left.distance - right.distance;
    if (distanceOrder) return distanceOrder;
    return sort === 'LOW_FIRST'
      ? right.assetId.localeCompare(left.assetId)
      : left.assetId.localeCompare(right.assetId);
  });
}
function formatSimilarity(distance: number) {
  return `${((1 - distance) * 100).toFixed(1)}%`;
}
function AssetGrid({
  children,
  ariaLabel,
  onClear,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  onClear: () => void;
}) {
  return (
    <div className={styles.assetGrid} role="grid" aria-label={ariaLabel} onClick={onClear}>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
}
function LoadMore({ disabled, onClick }: { disabled: boolean; onClick: () => Promise<void> }) {
  return (
    <button
      className={styles.loadMore}
      disabled={disabled}
      type="button"
      onClick={() => void onClick()}
    >
      {' ' + t('加载更多') + ' '}
    </button>
  );
}
function Preview({
  asset,
}: {
  asset: {
    id: string;
    displayName: string;
    renditions: Array<{
      id: string;
      width: number | null;
      height: number | null;
    }>;
  };
}) {
  const src = getVectorThumbnailUrl(asset);
  return src ? (
    <img src={src} alt="" loading="lazy" />
  ) : (
    <div className={styles.placeholder}>{t('暂无缩略图')}</div>
  );
}
function SuggestionCard({
  suggestion,
  selected,
  batchSelection,
  onSelect,
  onReview,
  onContextMenu,
  disabled,
}: {
  suggestion: EagleVectorSuggestion;
  selected: boolean;
  batchSelection: boolean;
  onSelect: (gesture: EagleSelectionGesture) => void;
  onReview: (action: 'ACCEPT' | 'REJECT') => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled: boolean;
}) {
  return (
    <article className={`${styles.assetCard} ${selected ? styles.assetCardSelected : ''}`}>
      <button
        className={styles.assetSelectionTarget}
        type="button"
        aria-label={t('选择 {{value1}}，建议{{value2}}', {
          value1: suggestion.asset.displayName,
          value2: suggestion.suggestedTag.name,
        })}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(getSelectionGesture(event));
        }}
        onContextMenu={onContextMenu}
      >
        <Preview asset={suggestion.asset} />
        {batchSelection ? <SelectionMark selected={selected} /> : null}
        <div className={styles.assetInfo}>
          <span>
            {t('建议：')}
            {suggestion.suggestedTag.name}
          </span>
          <strong className={styles.similarity}>{(suggestion.score * 100).toFixed(1)}%</strong>
        </div>
      </button>
      <div className={styles.cardActions}>
        <button disabled={disabled} type="button" onClick={() => onReview('ACCEPT')}>
          {' ' + t('确认') + ' '}
        </button>
        <button disabled={disabled} type="button" onClick={() => onReview('REJECT')}>
          {' ' + t('拒绝') + ' '}
        </button>
      </div>
    </article>
  );
}
function UnclassifiedCard({
  asset,
  selected,
  batchSelection,
  onSelect,
  onContextMenu,
}: {
  asset: EagleUnclassifiedAsset;
  selected: boolean;
  batchSelection: boolean;
  onSelect: (gesture: EagleSelectionGesture) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const embedding = asset.embeddings[0];
  const state = !embedding
    ? t('向量处理中')
    : embedding.status === 'FAILED'
      ? t('向量失败：{{value1}}', {
          value1: embedding.errorCode ?? t('未知原因'),
        })
      : t('相似度不足或没有可用标签中心');
  return (
    <article className={`${styles.assetCard} ${selected ? styles.assetCardSelected : ''}`}>
      <button
        className={styles.assetSelectionTarget}
        type="button"
        aria-label={t('选择 {{value1}}', {
          value1: asset.displayName,
        })}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(getSelectionGesture(event));
        }}
        onContextMenu={onContextMenu}
      >
        <Preview asset={asset} />
        {batchSelection ? <SelectionMark selected={selected} /> : null}
        <div className={styles.assetInfo}>
          <strong>{asset.displayName}</strong>
          <span>{state}</span>
        </div>
      </button>
    </article>
  );
}
function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span className={styles.selectionMark} aria-hidden="true">
      {selected ? <IconCheck size={14} stroke={3} /> : null}
    </span>
  );
}
function getSelectionGesture(event: MouseEvent<HTMLButtonElement>): EagleSelectionGesture {
  if (event.shiftKey) return 'range';
  if (event.metaKey || event.ctrlKey) return 'toggle';
  return 'single';
}
