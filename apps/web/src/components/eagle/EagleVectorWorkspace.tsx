import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchEagleVectorSummary,
  getVectorThumbnailUrl,
  listEagleTagDistanceAssets,
  listEagleUnclassifiedAssets,
  listEagleVectorSuggestions,
  listEagleVectorTags,
  rebuildEagleVectorTag,
  retryFailedEagleEmbeddings,
  reviewEagleVectorSuggestions,
  setEagleVectorTagEnabled,
  type EagleTagDistanceAsset,
  type EagleUnclassifiedAsset,
  type EagleVectorSuggestion,
  type EagleVectorSummary,
  type EagleVectorTag,
} from '../../lib/eagle-vector-api';
import styles from './EagleVectorWorkspace.module.css';

type View = 'REVIEW' | 'TAGS' | 'UNCLASSIFIED' | 'DISTANCE';

export function EagleVectorWorkspace() {
  const [summary, setSummary] = useState<EagleVectorSummary | null>(null);
  const [tags, setTags] = useState<EagleVectorTag[]>([]);
  const [suggestions, setSuggestions] = useState<EagleVectorSuggestion[]>([]);
  const [unclassified, setUnclassified] = useState<EagleUnclassifiedAsset[]>([]);
  const [distances, setDistances] = useState<EagleTagDistanceAsset[]>([]);
  const [view, setView] = useState<View>('REVIEW');
  const [tagFilter, setTagFilter] = useState('');
  const [distanceTag, setDistanceTag] = useState<EagleVectorTag | null>(null);
  const [distanceDirection, setDistanceDirection] = useState<'ASC' | 'DESC'>('DESC');
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
      setSelected([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取向量处理状态失败');
    }
  }, [tagFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const visibleTags = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN');
    return keyword
      ? tags.filter((tag) => tag.name.toLocaleLowerCase('zh-CN').includes(keyword))
      : tags;
  }, [search, tags]);

  const openDistance = async (tag: EagleVectorTag) => {
    setBusy(true);
    setError('');
    try {
      const result = await listEagleTagDistanceAssets(tag.id, distanceDirection);
      setDistanceTag(tag);
      setDistances(result.items);
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
        <button data-active={view === 'REVIEW'} onClick={() => setView('REVIEW')} type="button">
          智能标签确认 <span>{summary?.suggestions.pending ?? 0}</span>
        </button>
        <button data-active={view === 'TAGS'} onClick={() => setView('TAGS')} type="button">
          推荐标签 <span>{summary?.tags.enabled ?? 0}</span>
        </button>
        <button
          data-active={view === 'UNCLASSIFIED'}
          onClick={() => setView('UNCLASSIFIED')}
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
                      {tag.name}
                    </option>
                  ))}
              </select>
            </label>
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
          <AssetGrid>
            {suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                checked={selected.includes(suggestion.id)}
                onCheck={(checked) =>
                  setSelected((current) =>
                    checked
                      ? [...current, suggestion.id]
                      : current.filter((id) => id !== suggestion.id),
                  )
                }
                onReview={(action) => void review([suggestion.id], action)}
                disabled={busy}
              />
            ))}
          </AssetGrid>
          {!suggestions.length ? <Empty text="当前没有待确认的人工标签建议。" /> : null}
        </section>
      ) : null}

      {view === 'TAGS' ? (
        <section className={styles.panel} aria-label="推荐标签设置">
          <div className={styles.toolbar}>
            <input
              aria-label="搜索人工标签"
              placeholder="搜索几百个标签…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className={styles.tagList}>
            {visibleTags.map((tag) => (
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
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={tag.recommendationEnabled}
                    disabled={busy}
                    onChange={(event) =>
                      void act(
                        () => setEagleVectorTagEnabled(tag.id, event.target.checked),
                        event.target.checked ? `已开启“${tag.name}”` : `已关闭“${tag.name}”`,
                      )
                    }
                  />
                  <span />
                  参与智能推荐
                </label>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !tag.recommendationEnabled ||
                    tag.assetCount === 0 ||
                    Boolean(tag.activeBuild)
                  }
                  onClick={() =>
                    void act(() => rebuildEagleVectorTag(tag.id), `“${tag.name}”中心已进入后台构建`)
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
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'UNCLASSIFIED' ? (
        <section className={styles.panel} aria-label="没有可用建议">
          <p className={styles.explainer}>
            这些图片没有任何人工标签，也没有当前可审核建议。向量仍在处理或最高相似度不足时都会出现在这里。
          </p>
          <AssetGrid>
            {unclassified.map((asset) => (
              <UnclassifiedCard key={asset.id} asset={asset} />
            ))}
          </AssetGrid>
          {!unclassified.length ? <Empty text="当前没有遗漏的未分类图片。" /> : null}
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
                onChange={async (event) => {
                  const direction = event.target.value as 'ASC' | 'DESC';
                  setDistanceDirection(direction);
                  const result = await listEagleTagDistanceAssets(distanceTag.id, direction);
                  setDistances(result.items);
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
        </section>
      ) : null}
    </section>
  );
}

function AssetGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.assetGrid}>{children}</div>;
}
function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
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
  checked,
  onCheck,
  onReview,
  disabled,
}: {
  suggestion: EagleVectorSuggestion;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onReview: (action: 'ACCEPT' | 'REJECT') => void;
  disabled: boolean;
}) {
  return (
    <article className={styles.assetCard}>
      <Preview asset={suggestion.asset} />
      <label className={styles.check}>
        <input
          aria-label={`选择 ${suggestion.asset.displayName}`}
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
        />
      </label>
      <div className={styles.assetInfo}>
        <strong>{suggestion.asset.displayName}</strong>
        <span>建议：{suggestion.suggestedTag.name}</span>
        <small>
          相似度 {(suggestion.score * 100).toFixed(1)}% · 中心 {suggestion.prototypeRank + 1}
        </small>
        <div>
          <button disabled={disabled} type="button" onClick={() => onReview('ACCEPT')}>
            确认
          </button>
          <button disabled={disabled} type="button" onClick={() => onReview('REJECT')}>
            拒绝
          </button>
        </div>
      </div>
    </article>
  );
}

function UnclassifiedCard({ asset }: { asset: EagleUnclassifiedAsset }) {
  const embedding = asset.embeddings[0];
  const state = !embedding
    ? '向量处理中'
    : embedding.status === 'FAILED'
      ? `向量失败：${embedding.errorCode ?? '未知原因'}`
      : '相似度不足或没有可用标签中心';
  return (
    <article className={styles.assetCard}>
      <Preview asset={asset} />
      <div className={styles.assetInfo}>
        <strong>{asset.displayName}</strong>
        <span>{state}</span>
      </div>
    </article>
  );
}
