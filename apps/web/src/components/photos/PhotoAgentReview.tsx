import { useRef, useState } from 'react';
import { EagleAssetActionMenu } from '../eagle/EagleAssetActionMenu';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconArrowLeft,
  IconArrowRight,
  IconInbox,
  IconRefresh,
  IconShieldCheck,
} from '@tabler/icons-react';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  manualPhotoRequestAction,
  type ManualPhotoAction,
  listPhotoAgentTasks,
  getPhotoAgentTask,
  getPhotoAgentHistory,
  reviewPhotoRequest,
  undoPhotoAgentSuggestion,
  type PhotoAgentTask,
  type PhotoAgentTaskSummary,
  type PhotoAgentSuggestion,
  type PhotoCity,
  type PhotoRequestReviewResult,
} from '../../lib/photo-agent-api';
import styles from './PhotoAgentReview.module.css';
import { PhotoAgentInstructions } from './PhotoAgentInstructions';

const kindLabel = (kind: PhotoAgentTaskSummary['kind']) =>
  kind === 'CITY' ? t('补充位置') : kind === 'SEND_TO_MATERIAL' ? t('发送到素材') : t('移入回收站');
const statusLabel = (status: PhotoAgentSuggestion['status']) =>
  ({
    PENDING: t('待审批'),
    APPLYING: t('执行中，可手动重试'),
    FAILED: t('执行失败，可手动重试'),
    ACCEPTED: t('已同意并执行'),
    REJECTED: t('已拒绝'),
    UNDONE: t('已撤销'),
  })[status];
const previewUrl = (id: string) => `/api/photos/agent/photos/${encodeURIComponent(id)}/preview`;
const pending = (row: PhotoAgentTaskSummary) =>
  row.status === 'OPEN' &&
  !(row.expiresAt && Date.parse(row.expiresAt) <= Date.now()) &&
  (row.pendingCount ?? 0) + (row.retryCount ?? 0) > 0;

export function PhotoAgentReview({ includePrivate }: { includePrivate: boolean }) {
  const { ownerId } = useLibraryWorkspace();
  const client = useQueryClient();
  const key = ['eagle', ownerId, 'PHOTO', 'agent', includePrivate];
  const [taskId, setTaskId] = useState('');
  const [filter, setFilter] = useState<'pending' | 'done' | 'all'>('pending');
  const tasks = useInfiniteQuery({
    queryKey: [...key, 'tasks'],
    queryFn: ({ pageParam, signal }) => listPhotoAgentTasks(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 10000,
  });
  const detail = useQuery({
    queryKey: [...key, 'task', taskId],
    queryFn: ({ signal }) => getPhotoAgentTask(taskId, signal),
    enabled: Boolean(taskId),
    refetchInterval: 10000,
  });
  const rows =
    tasks.data?.pages.flatMap((page) => page.items).filter((row) => row.assetCount > 0) ?? [];
  const visible = rows.filter(
    (row) => filter === 'all' || (filter === 'pending' ? pending(row) : !pending(row)),
  );
  async function refresh() {
    // Invalidate library views for their next visit without waiting for unrelated statistics.
    await client.invalidateQueries({ queryKey: ['eagle', ownerId], refetchType: 'none' });
    await Promise.all([
      client.invalidateQueries({ queryKey: [...key, 'tasks'] }),
      ...(taskId ? [client.invalidateQueries({ queryKey: [...key, 'task', taskId] })] : []),
    ]);
  }
  return (
    <section className={styles.panel} aria-label={t('整理审批')}>
      <header className={styles.intro}>
        <IconShieldCheck size={21} aria-hidden />
        <div>
          <h2>{t('由 Agent 提议，由你决定')}</h2>
          <p>{t('申请不会自动执行。你可以同意建议，也可以选中照片直接处理。')}</p>
        </div>
      </header>
      {!taskId && <PhotoAgentInstructions key={ownerId} ownerId={ownerId} />}
      {taskId ? (
        <button className={styles.back} type="button" onClick={() => setTaskId('')}>
          <IconArrowLeft size={14} aria-hidden />
          {t('返回申请列表')}
        </button>
      ) : (
        <div className={styles.toolbar}>
          <div role="group" aria-label={t('申请状态')} className={styles.tabs}>
            {(['pending', 'done', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === 'pending' ? t('待处理') : value === 'done' ? t('已处理') : t('全部')}
              </button>
            ))}
          </div>
          <span>{t('已加载 {{value1}} 份申请', { value1: rows.length })}</span>
          <button type="button" aria-label={t('刷新申请')} onClick={() => void refresh()}>
            <IconRefresh size={15} aria-hidden />
          </button>
        </div>
      )}
      {(tasks.error || detail.error) && (
        <p role="alert">{tasks.error?.message || detail.error?.message}</p>
      )}
      {!taskId && tasks.isPending && <p role="status">{t('正在加载申请…')}</p>}
      {!taskId && !tasks.isPending && !tasks.isError && !visible.length && (
        <div className={styles.empty}>
          <IconInbox size={32} aria-hidden />
          <h3>{t('这里暂时没有申请')}</h3>
          <p>
            {t(
              '让 Agent 将整理建议按批提交到这里。你可以整批同意，也可以排除部分照片；无需逐张回复 Agent。',
            )}
          </p>
        </div>
      )}
      {!taskId && (
        <div className={styles.requests}>
          {visible.map((row) => (
            <button
              type="button"
              className={styles.request}
              key={row.id}
              onClick={() => setTaskId(row.id)}
            >
              <div className={styles.requestTop}>
                <span className={styles.number}>
                  {t('建议 {{value1}}', { value1: row.number })}
                </span>
                <span className={styles.kind}>{kindLabel(row.kind)}</span>
                <span>{t('{{value1}} 张', { value1: row.assetCount })}</span>
                <span className={styles.badge}>{pending(row) ? t('待处理') : t('已处理')}</span>
              </div>
              <h3>{row.title || kindLabel(row.kind)}</h3>
              <p>{row.rationale || t('查看 Agent 提交的逐项理由和依据。')}</p>
              {!!row.coverIds?.length && (
                <div className={styles.covers}>
                  {row.coverIds.map((id) => (
                    <img key={id} src={previewUrl(id)} loading="lazy" alt="" />
                  ))}
                </div>
              )}
              <div className={styles.requestBottom}>
                <span>
                  {t('待审批 {{value1}} · 已执行 {{value2}}', {
                    value1: row.pendingCount ?? 0,
                    value2: row.acceptedCount ?? 0,
                  })}
                </span>
                <span>
                  {t('查看申请')} <IconArrowRight size={13} aria-hidden />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      {!taskId && tasks.hasNextPage && (
        <button
          type="button"
          className={styles.more}
          disabled={tasks.isFetchingNextPage}
          onClick={() => void tasks.fetchNextPage()}
        >
          {t('载入更多申请')}
        </button>
      )}
      {taskId && detail.isPending && <p role="status">{t('正在加载申请…')}</p>}
      {taskId && detail.data && (
        <RequestDetail
          key={`${ownerId}:${includePrivate}:${taskId}`}
          task={detail.data}
          includePrivate={includePrivate}
          refresh={refresh}
        />
      )}
    </section>
  );
}
function RequestDetail({
  task,
  refresh,
  includePrivate,
}: {
  task: PhotoAgentTask;
  refresh: () => Promise<void>;
  includePrivate: boolean;
}) {
  const closed =
    task.status !== 'OPEN' || Boolean(task.expiresAt && Date.parse(task.expiresAt) <= Date.now());
  const eligible = task.suggestions.filter((item) =>
    ['PENDING', 'FAILED', 'APPLYING'].includes(item.status),
  );
  const selectable = task.suggestions.filter((item) => {
    const asset = task.assets.find((a) => a.id === item.assetId);
    return asset && !asset.deletedAt && item.status !== 'APPLYING';
  });
  const [selected, setSelected] = useState(() => new Set(eligible.map((item) => item.id)));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<string | null>(null);
  const manualIds = useRef(new Map<string, string>());
  const [manualMessage, setManualMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [batchTotal, setBatchTotal] = useState(0);
  const [result, setResult] = useState<PhotoRequestReviewResult | null>(null);
  const chosen = eligible.filter((item) => selected.has(item.id));
  const manualChosen = selectable.filter((item) => selected.has(item.id));
  const shown = expanded ? task.suggestions : task.suggestions.slice(0, 12);
  function choose(id: string, additive = false, range = false) {
    if (busy || !selectable.some((i) => i.id === id)) return;
    const previousAnchor = anchor.current;
    anchor.current = id;
    setSelected((current) => {
      if (range && previousAnchor) {
        const ids = selectable.map((i) => i.id),
          a = ids.indexOf(previousAnchor),
          b = ids.indexOf(id);
        if (a >= 0 && b >= 0)
          return new Set([...current, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)]);
      }
      if (!additive) return new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function openMenu(id: string, x: number, y: number) {
    if (busy || !selectable.some((i) => i.id === id)) return;
    if (!selected.has(id)) setSelected(new Set([id]));
    anchor.current = id;
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 240)),
      y: Math.max(8, Math.min(y, window.innerHeight - 150)),
    });
  }
  async function manual(action: ManualPhotoAction) {
    if (busy || !manualChosen.length) return;
    const items = manualChosen.map((item) => {
      const asset = task.assets.find((a) => a.id === item.assetId)!;
      return {
        suggestionId: item.id,
        mediaRevision: asset.mediaRevision,
        rowVersion: asset.rowVersion,
      };
    });
    setMenu(null);
    setBusy(true);
    setError('');
    setResult(null);
    setBatchTotal(0);
    setManualMessage('');
    let affected = 0;
    try {
      for (let offset = 0; offset < items.length; offset += 100) {
        const chunk = items.slice(offset, offset + 100),
          key = JSON.stringify({ action, items: chunk });
        let operationId = manualIds.current.get(key);
        if (!operationId) {
          operationId = crypto.randomUUID();
          manualIds.current.set(key, operationId);
        }
        const receipt = await manualPhotoRequestAction(task.id, {
          operationId,
          action,
          items: chunk,
        });
        affected += receipt.affectedAssetCount;
        manualIds.current.delete(key);
        setSelected(
          (current) =>
            new Set([...current].filter((id) => !chunk.some((i) => i.suggestionId === id))),
        );
        setManualMessage(t('已手动处理 {{value1}} 张照片', { value1: affected }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  async function review(action: 'ACCEPT' | 'REJECT') {
    const ids = chosen
      .filter((item) => action === 'ACCEPT' || item.status === 'PENDING')
      .map((item) => item.id);
    if (!ids.length) return;
    setBusy(true);
    setBatchTotal(ids.length);
    setError('');
    setResult(null);
    try {
      const accumulated: PhotoRequestReviewResult = { results: [], succeeded: 0, failed: 0 };
      for (let offset = 0; offset < ids.length; offset += 5) {
        const outcome = await reviewPhotoRequest(task.id, ids.slice(offset, offset + 5), action);
        accumulated.results.push(...outcome.results);
        accumulated.succeeded += outcome.succeeded;
        accumulated.failed += outcome.failed;
        setResult({ ...accumulated, results: [...accumulated.results] });
        setSelected(
          (current) =>
            new Set(
              [...current].filter(
                (id) => !outcome.results.some((item) => item.id === id && item.status !== 'ERROR'),
              ),
            ),
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  async function undo(id: string) {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      await undoPhotoAgentSuggestion(task.id, id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  return (
    <section className={styles.detail} aria-label={t('申请详情')}>
      <div className={styles.requestTop}>
        <span className={styles.number}>{t('建议 {{value1}}', { value1: task.number })}</span>
        <span className={styles.kind}>{kindLabel(task.kind)}</span>
        <span>{t('{{value1}} 张', { value1: task.suggestions.length })}</span>
      </div>
      <h2>{task.title || kindLabel(task.kind)}</h2>
      <p className={styles.reason}>
        {task.rationale || t('查看下方逐项理由和依据，再决定是否同意。')}
      </p>
      <div className={styles.effect}>
        {task.kind === 'CITY'
          ? t('同意后补充带有精度和来源的位置记录，原始 GPS 与文件保持不变。')
          : task.kind === 'SEND_TO_MATERIAL'
            ? t('同意后发送到素材模式，成功的图片不再显示在照片模式中。')
            : t('同意后移入照片回收站，可在回收站恢复。')}
      </div>
      {closed && <p role="status">{t('申请已关闭或过期，不能执行新操作。')}</p>}
      {Boolean(selectable.length || eligible.length) && (
        <div className={styles.approvalBar}>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={manualChosen.length === selectable.length}
              onChange={(event) =>
                setSelected(new Set(event.target.checked ? selectable.map((item) => item.id) : []))
              }
            />
            {t('全选照片')}
          </label>
          <span>
            {t('已选 {{value1}} / {{value2}} 张', {
              value1: manualChosen.length,
              value2: selectable.length,
            })}
          </span>
          <button
            className={styles.agree}
            type="button"
            disabled={busy || closed || !chosen.length}
            onClick={() => void review('ACCEPT')}
          >
            {busy ? t('正在执行…') : t('同意选中申请')}
          </button>
          <button
            type="button"
            disabled={busy || closed || !chosen.some((item) => item.status === 'PENDING')}
            onClick={() => void review('REJECT')}
          >
            {t('拒绝选中申请')}
          </button>
          <button
            type="button"
            disabled={busy || !manualChosen.length}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({
                x: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
                y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 150)),
              });
            }}
          >
            {t('处理选中照片')}
          </button>
        </div>
      )}
      {busy && batchTotal === 0 && <p role="status">{t('正在处理选中的照片…')}</p>}
      {manualMessage && <p role="status">{manualMessage}</p>}
      {busy && batchTotal > 0 && (
        <p role="status">
          {t('正在处理整批申请：{{value1}} / {{value2}} 张', {
            value1: result?.results.length ?? 0,
            value2: batchTotal,
          })}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div className={styles.result} role={result.failed ? 'alert' : 'status'}>
          <p>
            {t('本次成功 {{value1}} 项，失败 {{value2}} 项。', {
              value1: result.succeeded,
              value2: result.failed,
            })}
          </p>
          {result.results
            .filter((item) => item.error)
            .map((item) => (
              <p key={item.id}>
                {
                  task.assets.find(
                    (asset) =>
                      asset.id ===
                      task.suggestions.find((suggestion) => suggestion.id === item.id)?.assetId,
                  )?.displayName
                }
                : {item.error}
              </p>
            ))}
        </div>
      )}
      <div className={styles.photoGrid}>
        {shown.map((item) => {
          const asset = task.assets.find((asset) => asset.id === item.assetId);
          const location = item.kind === 'CITY' ? (item.value as PhotoCity) : null;
          return (
            <article
              className={styles.photo}
              key={item.id}
              data-selected={selected.has(item.id)}
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('button,input,summary,details,a'))
                  choose(item.id, event.ctrlKey || event.metaKey, event.shiftKey);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(item.id, event.clientX, event.clientY);
              }}
            >
              <span className={styles.photoNumber}>
                {task.number}.{item.number}
              </span>
              <div className={styles.image}>
                <button
                  type="button"
                  className={styles.selectPhoto}
                  disabled={busy || !selectable.some((i) => i.id === item.id)}
                  aria-label={t('选择照片 {{value1}}', { value1: `${task.number}.${item.number}` })}
                  aria-pressed={selected.has(item.id)}
                  onClick={(event) =>
                    choose(item.id, event.ctrlKey || event.metaKey, event.shiftKey)
                  }
                >
                  <ApprovalPreview
                    asset={asset}
                    kind={item.manualAction ?? item.kind}
                    status={item.status}
                  />
                </button>
                {selectable.some((i) => i.id === item.id) && (
                  <input
                    type="checkbox"
                    disabled={busy}
                    aria-label={t('选择 {{value1}}', { value1: asset?.displayName || t('照片') })}
                    checked={selected.has(item.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                  />
                )}
              </div>
              <div className={styles.photoBody}>
                <h3>{asset?.displayName || t('照片')}</h3>
                <span className={styles.itemStatus}>
                  {item.manualAction
                    ? item.manualAction === 'DELETE'
                      ? t('已手动移入回收站')
                      : t('已手动发送到素材')
                    : statusLabel(item.status)}
                </span>
                {location && (
                  <p>
                    {location.name} ·{' '}
                    {location.precision === 'EXACT'
                      ? t('精确坐标 · 精度 {{value1}} 米', {
                          value1: location.accuracyMeters ?? '—',
                        })
                      : t('城市级位置')}
                    <br />
                    {location.latitude}, {location.longitude}
                  </p>
                )}
                {item.reviewBasis === 'METADATA' && (
                  <span className={styles.basis}>{t('仅文字依据 · 未看图片')}</span>
                )}
                <p>{item.rationale}</p>
                <details>
                  <summary>{t('查看参考依据')}</summary>
                  {item.evidence
                    .filter((reference) => reference.id !== item.assetId)
                    .map((reference) => {
                      const photo = task.assets.find((asset) => asset.id === reference.id);
                      return photo?.previewId && !photo.deletedAt ? (
                        <figure key={reference.id}>
                          <img loading="lazy" src={previewUrl(photo.id)} alt={photo.displayName} />
                          <figcaption>{photo.displayName}</figcaption>
                        </figure>
                      ) : null;
                    })}
                  <p>{t('理由由 Agent 提交，请结合照片内容判断。')}</p>
                </details>
                {item.status === 'ACCEPTED' &&
                  !item.manualAction &&
                  item.kind !== 'SEND_TO_MATERIAL' && (
                    <button type="button" disabled={busy} onClick={() => void undo(item.id)}>
                      {t('撤销此项操作')}
                    </button>
                  )}
              </div>
            </article>
          );
        })}
      </div>
      {!expanded && task.suggestions.length > 12 && (
        <button className={styles.more} type="button" onClick={() => setExpanded(true)}>
          {t('展开全部 {{value1}} 张照片', { value1: task.suggestions.length })}
        </button>
      )}
      {menu && manualChosen.length > 0 && (
        <EagleAssetActionMenu
          position={menu}
          count={manualChosen.length}
          onClose={() => setMenu(null)}
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void manual('SEND_TO_MATERIAL')}
          >
            {t('发送到素材')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void manual('DELETE')}
          >
            {t('移入回收站')}
          </button>
        </EagleAssetActionMenu>
      )}
      <RequestHistory task={task} includePrivate={includePrivate} />
    </section>
  );
}

function RequestHistory({
  task,
  includePrivate,
}: {
  task: PhotoAgentTask;
  includePrivate: boolean;
}) {
  const { ownerId } = useLibraryWorkspace();
  const history = useInfiniteQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'agent', includePrivate, 'history', task.id],
    queryFn: ({ pageParam, signal }) => getPhotoAgentHistory(task.id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 10000,
  });
  const labels = {
    MANUAL_STARTED: t('开始人工处理'),
    MANUAL_EXECUTED: t('人工处理完成'),
    MANUAL_FAILED: t('人工处理失败'),
    PROPOSED: t('提交申请'),
    REJECTED: t('拒绝申请'),
    EXECUTED: t('执行成功'),
    EXECUTION_STARTED: t('同意并开始执行'),
    EXECUTION_FAILED: t('执行失败'),
    UNDONE: t('撤销成功'),
    CANCELLED: t('取消申请'),
    REVIEW_FAILED: t('审核执行失败'),
    UNDO_FAILED: t('撤销失败'),
  };
  return (
    <details className={styles.history}>
      <summary>{t('操作记录')}</summary>
      <p>{t('记录提交、人工决定、执行与撤销；撤销不会删除原记录。')}</p>
      {history.isPending && <p role="status">{t('正在加载操作记录…')}</p>}
      {history.error && <p role="alert">{history.error.message}</p>}
      <ol>
        {history.data?.pages
          .flatMap((page) => page.items)
          .map((event) => (
            <li key={event.id}>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
              <span>
                {event.actor === 'AGENT' ? 'Agent' : event.actor === 'HUMAN' ? t('你') : t('系统')}
              </span>
              <strong>{labels[event.action]}</strong>
              <span>
                {task.assets.find((asset) => asset.id === event.assetId)?.displayName ||
                  t('整份申请')}
              </span>
              {event.details.input && (
                <small>
                  {event.details.input.action === 'DELETE' ? t('移入回收站') : t('发送到素材')} ·{' '}
                  {event.details.targets
                    ?.map((target) => {
                      const item = task.suggestions.find((s) => s.id === target.suggestionId);
                      return item ? `${task.number}.${item.number}` : '';
                    })
                    .filter(Boolean)
                    .join('、')}
                </small>
              )}
              {event.details.legacySnapshot && <small>{t('升级前状态快照')}</small>}
              {event.details.value?.name && (
                <small>
                  {event.details.value.name} · {event.details.value.latitude},{' '}
                  {event.details.value.longitude}
                </small>
              )}
              {event.details.error && <small>{event.details.error}</small>}
            </li>
          ))}
      </ol>
      {history.hasNextPage && (
        <button
          type="button"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {t('载入更早记录')}
        </button>
      )}
    </details>
  );
}

function ApprovalPreview({
  asset,
  kind,
  status,
}: {
  asset: PhotoAgentTask['assets'][number] | undefined;
  kind: PhotoAgentSuggestion['kind'];
  status: PhotoAgentSuggestion['status'];
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const available = Boolean(asset?.previewId && !asset.deletedAt);
  // Keep an already decoded preview for this mounted review card; never refetch a deleted source.
  if (asset && !failed && (available || loaded))
    return (
      <img
        loading="lazy"
        src={previewUrl(asset.id)}
        alt={asset.displayName}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    );
  const completed = status === 'ACCEPTED' || Boolean(asset?.deletedAt);
  return (
    <span>
      {completed
        ? kind === 'SEND_TO_MATERIAL'
          ? t('已发送到素材')
          : t('已移入回收站')
        : t('预览暂不可用')}
    </span>
  );
}
