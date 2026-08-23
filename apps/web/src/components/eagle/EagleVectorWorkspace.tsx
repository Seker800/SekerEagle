import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { IconCheck } from '@tabler/icons-react';
import { listEagleManualTags, type EagleManualTag } from '../../lib/eagle-api';
import {
  fetchEagleVectorSummary,
  getVectorThumbnailUrl,
  listEagleTagDistanceAssets,
  listEagleUnclassifiedAssets,
  listEagleVectorSuggestions,
  listEagleVectorTags,
  rebuildEagleVectorTag,
  retryFailedEagleEmbeddings,
  scanMissingEagleEmbeddings,
  reviewEagleVectorSuggestions,
  setEagleVectorTagEnabled,
  type EagleTagDistanceAsset,
  type EagleUnclassifiedAsset,
  type EagleVectorSuggestion,
  type EagleVectorSummary,
  type EagleVectorTag,
} from '../../lib/eagle-vector-api';
import { searchAndSortEagleTags } from './eagle-tag-index';
import { applyEagleSelection, type EagleSelectionGesture } from './eagle-selection';
import { EagleVirtualList } from './EagleVirtualList';
import styles from './EagleVectorWorkspace.module.css';

export type EagleVectorWorkspaceView = 'REVIEW' | 'TAGS' | 'UNCLASSIFIED';
type View = EagleVectorWorkspaceView | 'DISTANCE';

interface EagleVectorWorkspaceProps {
  view?: EagleVectorWorkspaceView;
  onViewChange?: (view: EagleVectorWorkspaceView) => void;
}

export function EagleVectorWorkspace({
  view: controlledView,
  onViewChange,
}: EagleVectorWorkspaceProps = {}) {
  const [summary, setSummary] = useState<EagleVectorSummary | null>(null);
  const [tags, setTags] = useState<EagleVectorTag[]>([]);
  const [suggestions, setSuggestions] = useState<EagleVectorSuggestion[]>([]);
  const [unclassified, setUnclassified] = useState<EagleUnclassifiedAsset[]>([]);
  const [distances, setDistances] = useState<EagleTagDistanceAsset[]>([]);
  const [suggestionCursor, setSuggestionCursor] = useState<string | null>(null);
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
  const [manualTags, setManualTags] = useState<EagleManualTag[]>([]);
  const [loadingManualTags, setLoadingManualTags] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const clearSelection = useCallback(() => {
    setSelected([]);
    setActiveSelectionId(null);
    setIsBatchSelection(false);
    selectionAnchorIdRef.current = null;
  }, []);

  const changeView = useCallback(
    (nextView: EagleVectorWorkspaceView) => {
      setView(nextView);
      setDistanceTag(null);
      clearSelection();
      onViewChange?.(nextView);
    },
    [clearSelection, onViewChange],
  );

  useEffect(() => {
    if (!controlledView) return;
    setView(controlledView);
    setDistanceTag(null);
    clearSelection();
  }, [clearSelection, controlledView]);

  const reload = useCallback(async () => {
    setError('');
    try {
      const [nextSummary, nextTags, nextSuggestions, nextUnclassified] = await Promise.all([
        fetchEagleVectorSummary(),
        listEagleVectorTags(),
        listEagleVectorSuggestions(tagFilter || undefined),
        listEagleUnclassifiedAssets(),
      ]);
      setSummary(nextSummary);
      setTags(nextTags);
      setSuggestions(nextSuggestions.items);
      setUnclassified(nextUnclassified.items);
      setSuggestionCursor(nextSuggestions.nextCursor);
      setUnclassifiedCursor(nextUnclassified.nextCursor);
      clearSelection();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取向量处理状态失败');
    }
  }, [clearSelection, tagFilter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
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
    if (view !== 'TAGS') return;
    let cancelled = false;
    setLoadingManualTags(true);
    void listEagleManualTags('')
      .then((results) => {
        if (!cancelled) setManualTags(results);
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
  }, [view]);

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

  const review = (ids: string[], action: 'ACCEPT' | 'REJECT') =>
    act(
      () => reviewEagleVectorSuggestions(ids, action),
      action === 'ACCEPT' ? `已确认 ${ids.length} 条人工标签建议` : `已拒绝 ${ids.length} 条建议`,
    );

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

  return (
    <section className={styles.workspace} aria-label="图片向量与人工标签建议">
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Qwen 图片向量</span>
          <h2>人工标签建议</h2>
          <p>从已开启且已建立中心的人工标签中推荐一个；确认后才写入人工标签。</p>
        </div>
        <div className={styles.coverage}>
          <strong>{summary?.embeddingCoverage.percentage ?? 0}%</strong>
          <span>图片向量覆盖</span>
          <small>
            {summary?.embeddingCoverage.ready ?? 0}/{summary?.embeddingCoverage.eligible ?? 0} ·{' '}
            {summary?.dimensions ?? 1024} 维
          </small>
          <small>
            等待 {summary?.embeddingCoverage.queued ?? 0} · 运行{' '}
            {summary?.embeddingCoverage.running ?? 0} · 未入队{' '}
            {summary?.embeddingCoverage.missing ?? 0}
          </small>
          {(summary?.embeddingCoverage.blocked ?? 0) > 0 ? (
            <small>无可用预览 {summary?.embeddingCoverage.blocked}，需先修复图片处理</small>
          ) : null}
          <button
            type="button"
            disabled={busy || (summary?.embeddingCoverage.missing ?? 0) === 0}
            onClick={() =>
              void act(scanMissingEagleEmbeddings, ({ created, repaired }) =>
                created || repaired
                  ? `已排队 ${created + repaired} 个缺失图片向量`
                  : '没有发现可排队的缺失图片向量',
              )
            }
          >
            扫描缺失向量
          </button>
          <small>
            {summary?.processingSchedule.mode === 'ALWAYS'
              ? '后台任务全天执行'
              : summary?.processingSchedule.mode === 'MANUAL'
                ? '后台任务已暂停'
                : `夜间 ${summary?.processingSchedule.nightStart ?? '23:00'}–${summary?.processingSchedule.nightEnd ?? '06:00'} 执行`}
          </small>
          <small>
            Metal 宿主：
            {summary?.host.status === 'ONLINE'
              ? '在线'
              : summary?.host.status === 'DRIFTED'
                ? '合同不一致'
                : '离线'}
          </small>
          {(summary?.embeddingCoverage.failed ?? 0) > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(retryFailedEagleEmbeddings, '失败的图片向量任务已重新排队')}
            >
              重试 {summary?.embeddingCoverage.failed} 个失败任务
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.boundary}>
        <strong>与 AI 自动标签分开</strong>
        <span>AI 自动标签未来由 Ollama 视觉模型独立生成，并写入 AI 标签体系。</span>
      </div>

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

      <nav className={styles.tabs} aria-label="向量处理视图">
        <button data-active={view === 'REVIEW'} onClick={() => changeView('REVIEW')} type="button">
          智能标签确认 <span>{summary?.suggestions.pending ?? 0}</span>
        </button>
        <button data-active={view === 'TAGS'} onClick={() => changeView('TAGS')} type="button">
          标签推荐设置 <span>{summary?.tags.enabled ?? 0}</span>
        </button>
        <button
          data-active={view === 'UNCLASSIFIED'}
          onClick={() => changeView('UNCLASSIFIED')}
          type="button"
        >
          没有可用建议{' '}
          <span>
            {Math.max(
              0,
              (summary?.suggestions.unclassified ?? 0) - (summary?.suggestions.pending ?? 0),
            )}
          </span>
        </button>
        {distanceTag ? (
          <button
            data-active={view === 'DISTANCE'}
            onClick={() => setView('DISTANCE')}
            type="button"
          >
            距离检查 · {distanceTag.name}
          </button>
        ) : null}
      </nav>

      {view === 'REVIEW' ? (
        <section className={styles.panel} aria-label="智能标签确认">
          <div className={styles.toolbar}>
            <label>
              推荐标签
              <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                <option value="">全部建议</option>
                {tags
                  .filter((tag) => tag.recommendationEnabled && tag.currentSnapshotId)
                  .map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}（{tag.pendingSuggestionCount}）
                    </option>
                  ))}
              </select>
            </label>
            <span className={styles.selectionCount}>已选择 {selected.length} 项</span>
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
          </div>
          <AssetGrid ariaLabel="待确认的智能标签建议" onClear={clearSelection}>
            {suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                selected={selected.includes(suggestion.id)}
                batchSelection={isBatchSelection}
                onSelect={(gesture) =>
                  selectItem(
                    suggestion.id,
                    suggestions.map((item) => item.id),
                    gesture,
                  )
                }
                onReview={(action) => void review([suggestion.id], action)}
                disabled={busy}
              />
            ))}
          </AssetGrid>
          {!suggestions.length ? <Empty text="当前没有待确认的人工标签建议。" /> : null}
          {suggestionCursor ? (
            <LoadMore
              disabled={busy}
              onClick={async () => {
                const result = await listEagleVectorSuggestions(
                  tagFilter || undefined,
                  suggestionCursor,
                );
                setSuggestions((current) => [...current, ...result.items]);
                setSuggestionCursor(result.nextCursor);
              }}
            />
          ) : null}
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
            <span>{summary?.tags.enabled ?? tags.length} 个标签</span>
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
        <section className={styles.panel} aria-label="没有可用建议">
          <p className={styles.explainer}>
            这些图片没有任何人工标签，也没有当前可审核建议。向量仍在处理或最高相似度不足时都会出现在这里。
          </p>
          <AssetGrid ariaLabel="没有可用建议的素材" onClear={clearSelection}>
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
  disabled,
}: {
  suggestion: EagleVectorSuggestion;
  selected: boolean;
  batchSelection: boolean;
  onSelect: (gesture: EagleSelectionGesture) => void;
  onReview: (action: 'ACCEPT' | 'REJECT') => void;
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
      >
        <Preview asset={suggestion.asset} />
        {batchSelection ? <SelectionMark selected={selected} /> : null}
        <div className={styles.assetInfo}>
          <strong>{suggestion.asset.displayName}</strong>
          <span>建议：{suggestion.suggestedTag.name}</span>
          <small>
            相似度 {(suggestion.score * 100).toFixed(1)}% · 中心 {suggestion.prototypeRank + 1}
          </small>
          {suggestion.representativeAssets.length ? (
            <div className={styles.evidence} aria-label="该中心代表图片">
              <span>代表图</span>
              {suggestion.representativeAssets.map((asset) => {
                const src = getVectorThumbnailUrl(asset);
                return src ? (
                  <img key={asset.id} src={src} alt={asset.displayName} loading="lazy" />
                ) : null;
              })}
            </div>
          ) : null}
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
}: {
  asset: EagleUnclassifiedAsset;
  selected: boolean;
  batchSelection: boolean;
  onSelect: (gesture: EagleSelectionGesture) => void;
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
