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
import { EagleVirtualList } from './EagleVirtualList';
import styles from './EagleVectorWorkspace.module.css';

export type EagleVectorWorkspaceView = 'REVIEW' | 'TAGS' | 'UNCLASSIFIED';
type View = EagleVectorWorkspaceView | 'DISTANCE';

interface EagleVectorWorkspaceProps {
  view?: EagleVectorWorkspaceView;
  manualTags?: EagleManualTag[];
  onAssignManualTags?: (assetIds: string[], tagIds: string[]) => Promise<void>;
  onCreateManualTag?: (name: string) => Promise<EagleManualTag>;
  onTrashAssets?: (assetIds: string[]) => Promise<void>;
}

export function EagleVectorWorkspace({
  view: controlledView,
  manualTags: providedManualTags,
  onAssignManualTags,
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
  const [distanceDirection, setDistanceDirection] = useState<'ASC' | 'DESC'>('DESC');
  const [selected, setSelected] = useState<string[]>([]);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null);
  const [isBatchSelection, setIsBatchSelection] = useState(false);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const [search, setSearch] = useState('');
  const [loadedManualTags, setLoadedManualTags] = useState<EagleManualTag[]>([]);
  const [loadingManualTags, setLoadingManualTags] = useState(false);
  const [tagPickerTarget, setTagPickerTarget] = useState<{
    assetIds: string[];
    suggestionIds: string[];
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
      setError(cause instanceof Error ? cause.message : '读取向量处理状态失败');
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
    }, 10_000);
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
    if (view !== 'TAGS' || providedManualTags) return;
    let cancelled = false;
    setLoadingManualTags(true);
    void listEagleManualTags('')
      .then((results) => {
        if (!cancelled) setLoadedManualTags(results);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取人工标签失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingManualTags(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providedManualTags, view]);

  const manualTags = providedManualTags ?? loadedManualTags;

  const reviewTags = useMemo(
    () =>
      tags
        .filter((tag) => tag.recommendationEnabled && tag.currentSnapshotId)
        .sort(
          (left, right) =>
            right.pendingSuggestionCount - left.pendingSuggestionCount ||
            left.name.localeCompare(right.name, 'zh-CN'),
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
      setError(cause instanceof Error ? cause.message : '操作失败');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addRecommendationTag = async (tag: Pick<EagleManualTag, 'id' | 'name'>) => {
    const added = await act(
      () => setEagleVectorTagEnabled(tag.id, true),
      `已添加“${tag.name}”参与推荐`,
    );
    if (added) {
      setSearch('');
    }
  };

  const openDistance = async (tag: EagleVectorTag) => {
    setBusy(true);
    setError('');
    try {
      const result = await listEagleTagDistanceAssets(tag.id, distanceDirection);
      setDistanceTag(tag);
      setDistances(result.items);
      setDistanceCursor(result.nextCursor);
      setView('DISTANCE');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取标签距离失败');
    } finally {
      setBusy(false);
    }
  };

  const review = async (ids: string[], action: 'ACCEPT' | 'REJECT') => {
    const reviewed = await act(
      () => reviewEagleVectorSuggestions(ids, action),
      action === 'ACCEPT' ? `已确认 ${ids.length} 条人工标签建议` : `已拒绝 ${ids.length} 条建议`,
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

  const openTagPicker = (itemIds: string[]) => {
    if (!onAssignManualTags || itemIds.length === 0) return;
    setContextMenu(null);
    setTagPickerTarget(getTagPickerTarget(itemIds));
  };

  const assignManualTags = async (tagIds: string[]) => {
    if (!tagPickerTarget || !onAssignManualTags) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (tagPickerTarget.suggestionIds.length) {
        await reviewEagleVectorSuggestions(tagPickerTarget.suggestionIds, 'REJECT');
      }
      await onAssignManualTags(tagPickerTarget.assetIds, tagIds);
      setNotice(`已为 ${tagPickerTarget.assetIds.length} 项素材添加人工标签`);
      setTagPickerTarget(null);
      clearSelection();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加人工标签失败');
    } finally {
      setBusy(false);
    }
  };

  const trashItems = async (itemIds: string[]) => {
    if (!onTrashAssets) return;
    const { assetIds } = getTagPickerTarget(itemIds);
    const trashed = await act(
      () => onTrashAssets(assetIds),
      `已将 ${assetIds.length} 项素材移到回收站`,
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
          eyebrow: '推荐语义',
          title: view === 'DISTANCE' ? `距离检查 · ${distanceTag?.name ?? ''}` : '标签推荐设置',
          description: '选择哪些人工标签参与推荐，并管理每个标签的向量中心。',
        }
      : view === 'UNCLASSIFIED'
        ? {
            eyebrow: '人工归类',
            title: '待手动分类',
            description: '这些素材暂时没有可靠推荐，请直接添加一个或多个人工标签。',
          }
        : {
            eyebrow: '人工标签建议',
            title: '智能标签确认',
            description: '确认可靠建议，拒绝不正确的结果，或为素材指定其他人工标签。',
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
          <strong>只写入人工标签</strong>
          <span>这里审核的是已有人工标签的向量推荐，不会写入 AI 自动标签。</span>
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
        <section className={styles.panel} aria-label="智能标签确认">
          <div className={styles.tagFilters} role="group" aria-label="推荐标签筛选">
            <span>推荐标签</span>
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
                <span>全部建议</span>
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
            <span className={styles.selectionCount}>已选择 {selected.length} 项</span>
            <button
              className={styles.primaryAction}
              type="button"
              disabled={!orderedSuggestionIds.length || busy}
              onClick={() => void review(orderedSuggestionIds, 'ACCEPT')}
            >
              本页全部确认
            </button>
            <button
              type="button"
              disabled={!selected.length || busy}
              onClick={() => void review(selected, 'ACCEPT')}
            >
              批量确认
            </button>
            <button
              type="button"
              disabled={!selected.length || busy}
              onClick={() => void review(selected, 'REJECT')}
            >
              批量拒绝
            </button>
            <button
              type="button"
              disabled={!selected.length || busy || !onAssignManualTags}
              onClick={() => openTagPicker(selected)}
            >
              指定其他标签
            </button>
          </div>
          <AssetGrid ariaLabel="待确认的智能标签建议" onClear={clearSelection}>
            {orderedSuggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                selected={selected.includes(suggestion.id)}
                batchSelection={isBatchSelection}
                onSelect={(gesture) =>
                  selectItem(
                    suggestion.id,
                    orderedSuggestionIds,
                    gesture,
                  )
                }
                onReview={(action) => void review([suggestion.id], action)}
                onContextMenu={(event) =>
                  openContextMenu(
                    event,
                    suggestion.id,
                    orderedSuggestionIds,
                  )
                }
                disabled={busy}
              />
            ))}
          </AssetGrid>
          {!suggestions.length ? <Empty text="当前没有待确认的人工标签建议。" /> : null}
        </section>
      ) : null}

      {view === 'TAGS' ? (
        <section className={styles.panel} aria-label="推荐标签设置">
          <div className={styles.tagSearch}>
            <label htmlFor="vector-tag-search">添加推荐标签</label>
            <input
              id="vector-tag-search"
              aria-label="搜索可添加的人工标签"
              autoComplete="off"
              placeholder="搜索名称、拼音或首字母"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <small>尚未参与推荐的标签；同等匹配下，素材数量多的优先。</small>
            <div className={styles.tagSearchResults} aria-label="可添加的标签">
              {loadingManualTags ? <span className={styles.searchHint}>正在读取标签…</span> : null}
              {!loadingManualTags && !availableTags.length ? (
                <span className={styles.searchHint}>
                  {search.trim() ? '没有找到可添加的标签。' : '没有尚未参与推荐的标签。'}
                </span>
              ) : null}
              {!loadingManualTags && availableTags.length ? (
                <EagleVirtualList
                  ariaLabel="可添加的标签列表"
                  className={styles.virtualTagResults}
                  items={availableTags}
                  itemKey={({ tag }) => tag.id}
                  rowHeight={47}
                  viewportHeight={260}
                  renderItem={({ tag }) => (
                    <article className={styles.tagCandidate}>
                      <span className={styles.tagDot} style={{ background: tag.color ?? '#777' }} />
                      <div>
                        <strong>{tag.name}</strong>
                        <small>{tag.assetCount} 张基础图片</small>
                      </div>
                      <button
                        type="button"
                        aria-label={`添加${tag.name}到标签推荐`}
                        disabled={busy}
                        onClick={() => void addRecommendationTag(tag)}
                      >
                        添加
                      </button>
                    </article>
                  )}
                />
              ) : null}
            </div>
          </div>

          <div className={styles.sectionHeading}>
            <strong>参与推荐</strong>
            <span>{tags.length} 个标签</span>
          </div>
          {tags.length ? (
            <div className={styles.tagList}>
              {tags.map((tag) => (
                <article className={styles.tagRow} key={tag.id}>
                  <span className={styles.tagDot} style={{ background: tag.color ?? '#777' }} />
                  <div>
                    <strong>{tag.name}</strong>
                    <small>
                      {tag.assetCount} 张基础图片
                      {tag.currentSnapshot
                        ? ` · v${tag.currentSnapshot.version} · ${tag.currentSnapshot.centerCount} 个中心`
                        : ' · 尚无中心'}
                    </small>
                  </div>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !tag.recommendationEnabled ||
                      tag.assetCount === 0 ||
                      Boolean(tag.activeBuild)
                    }
                    onClick={() =>
                      void act(
                        () => rebuildEagleVectorTag(tag.id),
                        `“${tag.name}”中心已进入后台构建`,
                      )
                    }
                  >
                    {tag.activeBuild ? '构建中…' : tag.currentSnapshot ? '刷新中心' : '生成中心'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !tag.currentSnapshot}
                    onClick={() => void openDistance(tag)}
                  >
                    距离检查
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => setEagleVectorTagEnabled(tag.id, false),
                        `已将“${tag.name}”移出推荐`,
                      )
                    }
                  >
                    移出推荐
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <Empty text="还没有参与推荐的标签，请从上方搜索并添加。" />
          )}
        </section>
      ) : null}

      {view === 'UNCLASSIFIED' ? (
        <section className={styles.panel} aria-label="待手动分类">
          <div className={styles.toolbar}>
            <span className={styles.selectionCount}>已选择 {selected.length} 项</span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  scanUnclassifiedEagleSuggestions,
                  ({ scanned, matched }) =>
                    `已扫描 ${scanned} 张无标签图片，新生成 ${matched} 条建议`,
                )
              }
            >
              扫描无标签图片
            </button>
            <button
              type="button"
              disabled={!selected.length || busy || !onAssignManualTags}
              onClick={() => openTagPicker(selected)}
            >
              添加人工标签
            </button>
          </div>
          <p className={styles.explainer}>
            可能原因包括向量仍在处理、相似度不足，或当前没有可用的标签中心。选择素材后可直接完成归类。
          </p>
          <AssetGrid ariaLabel="待手动分类的素材" onClear={clearSelection}>
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
          {!unclassified.length ? <Empty text="当前没有遗漏的未分类图片。" /> : null}
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
        <section className={styles.panel} aria-label="标签向量距离检查">
          <div className={styles.toolbar}>
            <button
              type="button"
              onClick={() => {
                setView('TAGS');
                setDistanceTag(null);
              }}
            >
              返回标签推荐设置
            </button>
            <strong>{distanceTag.name}</strong>
            <label>
              排序
              <select
                value={distanceDirection}
                onChange={(event) => {
                  const direction = event.target.value as 'ASC' | 'DESC';
                  setDistanceDirection(direction);
                  void listEagleTagDistanceAssets(distanceTag.id, direction).then((result) => {
                    setDistances(result.items);
                    setDistanceCursor(result.nextCursor);
                  });
                }}
              >
                <option value="DESC">由远到近</option>
                <option value="ASC">由近到远</option>
              </select>
            </label>
          </div>
          <div className={styles.distanceList}>
            {distances.map((item) => (
              <div key={item.assetId}>
                <strong>{item.asset.displayName}</strong>
                <span>
                  距离 {item.distance.toFixed(4)} · 中心 {item.prototypeRank + 1}
                </span>
              </div>
            ))}
          </div>
          {!distances.length ? <Empty text="该标签暂时没有可用的成员距离。" /> : null}
          {distanceCursor ? (
            <LoadMore
              disabled={busy}
              onClick={async () => {
                const result = await listEagleTagDistanceAssets(
                  distanceTag.id,
                  distanceDirection,
                  distanceCursor,
                );
                setDistances((current) => [...current, ...result.items]);
                setDistanceCursor(result.nextCursor);
              }}
            />
          ) : null}
        </section>
      ) : null}

      {contextMenu && (onAssignManualTags || onTrashAssets) ? (
        <div
          className={styles.contextMenu}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {onAssignManualTags ? (
            <button
              type="button"
              role="menuitem"
              aria-label={view === 'REVIEW' ? '指定其他标签' : '添加人工标签'}
              onClick={() => openTagPicker(contextMenu.itemIds)}
            >
              <IconTags size={15} />
              {view === 'REVIEW' ? '指定其他标签' : '添加人工标签'}
            </button>
          ) : null}
          {onTrashAssets ? (
            <button
              type="button"
              role="menuitem"
              aria-label="删除（移到回收站）"
              onClick={() => void trashItems(contextMenu.itemIds)}
            >
              <IconTrash size={15} />
              删除（移到回收站）
            </button>
          ) : null}
        </div>
      ) : null}

      {tagPickerTarget ? (
        <EagleBatchTagPicker
          assetCount={tagPickerTarget.assetIds.length}
          tags={manualTags}
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
      加载更多
    </button>
  );
}

function Preview({
  asset,
}: {
  asset: {
    id: string;
    displayName: string;
    renditions: Array<{ id: string; width: number | null; height: number | null }>;
  };
}) {
  const src = getVectorThumbnailUrl(asset);
  return src ? (
    <img src={src} alt="" loading="lazy" />
  ) : (
    <div className={styles.placeholder}>暂无缩略图</div>
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
        aria-label={`选择 ${suggestion.asset.displayName}，建议${suggestion.suggestedTag.name}`}
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
          <span>建议：{suggestion.suggestedTag.name}</span>
          <strong className={styles.similarity}>{(suggestion.score * 100).toFixed(1)}%</strong>
        </div>
      </button>
      <div className={styles.cardActions}>
        <button disabled={disabled} type="button" onClick={() => onReview('ACCEPT')}>
          确认
        </button>
        <button disabled={disabled} type="button" onClick={() => onReview('REJECT')}>
          拒绝
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
    ? '向量处理中'
    : embedding.status === 'FAILED'
      ? `向量失败：${embedding.errorCode ?? '未知原因'}`
      : '相似度不足或没有可用标签中心';
  return (
    <article className={`${styles.assetCard} ${selected ? styles.assetCardSelected : ''}`}>
      <button
        className={styles.assetSelectionTarget}
        type="button"
        aria-label={`选择 ${asset.displayName}`}
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
