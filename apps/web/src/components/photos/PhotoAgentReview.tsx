import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  listPhotoAgentTasks,
  getPhotoAgentTask,
  reviewPhotoAgentSuggestion,
  undoPhotoAgentSuggestion,
  cancelPhotoAgentTask,
  createPhotoAgentTask,
  type PhotoAgentSuggestion,
  type PhotoAgentTask,
  type PhotoCity,
} from '../../lib/photo-agent-api';
import styles from './PhotoAgentReview.module.css';
export function PhotoAgentReview({ includePrivate }: { includePrivate: boolean }) {
  const { ownerId } = useLibraryWorkspace();
  const client = useQueryClient();
  const key = ['eagle', ownerId, 'PHOTO', 'agent', includePrivate];
  const [taskId, setTaskId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [kind, setKind] = useState<'CITY' | 'NON_PHOTO'>('CITY');
  const [selected, setSelected] = useState<string[]>([]);
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
  const task = detail.data;
  const expired = task ? new Date(task.expiresAt).getTime() <= Date.now() : false;
  async function perform(action: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ['eagle', ownerId, 'PHOTO'] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      setBusy(false);
    }
  }
  async function batch(action: 'ACCEPT' | 'REJECT') {
    if (!task) return;
    const errors: string[] = [];
    for (const id of selected) {
      try {
        await reviewPhotoAgentSuggestion(task.id, id, action);
        setSelected((current) => current.filter((x) => x !== id));
      } catch (reason) {
        errors.push(reason instanceof Error ? reason.message : t('操作失败'));
      }
    }
    if (errors.length) throw new Error(errors.join('；'));
  }
  return (
    <section className={styles.panel} aria-label={t('智能整理')}>
      <h2>{t('智能整理')}</h2>
      <p>
        {t('Agent 提交建议后在这里审核。原始 GPS 和原文件保持不变，接受的城市仅表示城市级位置。')}
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            const start = new Date(`${from}T00:00:00`),
              end = new Date(`${to}T00:00:00`);
            end.setDate(end.getDate() + 1);
            const created = await createPhotoAgentTask(
              start.toISOString(),
              end.toISOString(),
              kind,
            );
            setTaskId(created.id);
            setSelected([]);
          });
        }}
      >
        <label>
          {t('开始日期')}
          <input required type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('结束日期')}
          <input
            required
            type="date"
            min={from}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          {t('整理类型')}
          <select value={kind} onChange={(e) => setKind(e.target.value as 'CITY' | 'NON_PHOTO')}>
            <option value="CITY">{t('城市定位')}</option>
            <option value="NON_PHOTO">{t('非照片清理')}</option>
          </select>
        </label>
        <button disabled={busy}>{t('创建整理任务')}</button>
      </form>
      <p>{t('一次任务最多 200 张。创建后交给已连接的 Agent 分析，不会自动修改照片。')}</p>
      {(error || tasks.error || detail.error) && (
        <p role="alert">{error || tasks.error?.message || detail.error?.message}</p>
      )}
      <div className={styles.tasks}>
        {tasks.data?.pages
          .flatMap((p) => p.items)
          .map((row) => (
            <button
              type="button"
              key={row.id}
              aria-pressed={taskId === row.id}
              onClick={() => {
                setTaskId(row.id);
                setSelected([]);
                setError('');
              }}
            >
              {row.kind === 'CITY' ? t('城市定位') : t('非照片清理')} · {row.assetCount} ·{' '}
              {row.status === 'CANCELLED' ? t('已取消') : t('查看建议')}
            </button>
          ))}
      </div>
      {tasks.hasNextPage && (
        <button disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>
          {t('载入更多任务')}
        </button>
      )}
      {tasks.isPending && <p role="status">{t('正在加载…')}</p>}
      {task && (
        <>
          <p>
            {t('任务编号')}：<code>{task.id}</code>
          </p>
          {(expired || task.status === 'CANCELLED') && (
            <p role="status">{t('任务已取消或过期，不能应用新建议；已应用项目仍可撤销。')}</p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || !selected.length || expired || task.status !== 'OPEN'}
              onClick={() => void perform(() => batch('ACCEPT'))}
            >
              {t('接受所选建议')}
            </button>
            <button
              type="button"
              disabled={busy || !selected.length || expired || task.status !== 'OPEN'}
              onClick={() => void perform(() => batch('REJECT'))}
            >
              {t('拒绝所选建议')}
            </button>
            <button
              type="button"
              disabled={busy || task.status === 'CANCELLED'}
              onClick={() => void perform(() => cancelPhotoAgentTask(task.id))}
            >
              {t('取消任务')}
            </button>
          </div>
          {!task.suggestions.length && (
            <p>{t('尚无建议。请让 Agent 读取此任务、查看照片并提交建议。')}</p>
          )}
          <div className={styles.grid}>
            {task.suggestions.map((s) => (
              <Suggestion
                key={s.id}
                task={task}
                suggestion={s}
                busy={busy}
                disabled={expired || task.status !== 'OPEN'}
                selected={selected.includes(s.id)}
                onSelect={(checked) =>
                  setSelected((current) =>
                    checked ? [...current, s.id] : current.filter((id) => id !== s.id),
                  )
                }
                perform={perform}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
function Suggestion({
  task,
  suggestion: s,
  busy,
  disabled,
  selected,
  onSelect,
  perform,
}: {
  task: PhotoAgentTask;
  suggestion: PhotoAgentSuggestion;
  busy: boolean;
  disabled: boolean;
  selected: boolean;
  onSelect: (value: boolean) => void;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const asset = task.assets.find((a) => a.id === s.assetId);
  const [city, setCity] = useState<PhotoCity | null>(
    s.kind === 'CITY' ? (s.value as PhotoCity) : null,
  );
  const [edited, setEdited] = useState(false);
  return (
    <article className={styles.card}>
      <h3>{asset?.displayName ?? t('照片')}</h3>
      {asset?.previewId && !asset.deletedAt && (
        <img
          loading="lazy"
          src={`/api/photos/agent/photos/${encodeURIComponent(asset.id)}/preview`}
          alt={asset.displayName}
        />
      )}
      <p>
        {s.kind === 'CITY'
          ? `${city?.country} · ${city?.region} · ${city?.name} · ${t('城市级推断')}`
          : t('建议移入照片回收站')}
      </p>
      <p>{s.rationale}</p>
      <p>
        {s.status === 'PENDING'
          ? t('待确认')
          : s.status === 'ACCEPTED'
            ? t('已应用')
            : s.status === 'UNDONE'
              ? t('已撤销')
              : t('已拒绝')}
      </p>
      <details>
        <summary>{t('查看参考照片')}</summary>
        {s.evidence.length ? (
          s.evidence.map((e) => {
            const reference = task.assets.find((a) => a.id === e.id);
            return (
              <figure key={e.id}>
                <figcaption>{reference?.displayName ?? t('照片')}</figcaption>
                {reference?.previewId && !reference.deletedAt && (
                  <img
                    loading="lazy"
                    src={`/api/photos/agent/photos/${encodeURIComponent(e.id)}/preview`}
                    alt={reference.displayName}
                  />
                )}
              </figure>
            );
          })
        ) : (
          <p>{t('此项依据当前照片画面和文件名，请核对后决定。')}</p>
        )}
      </details>
      {s.status === 'PENDING' && (
        <>
          <label>
            <input
              type="checkbox"
              checked={selected}
              disabled={busy || disabled}
              onChange={(e) => onSelect(e.target.checked)}
            />
            {t('选择此建议')}
          </label>
          {city && (
            <details>
              <summary>{t('修改城市')}</summary>
              {(['id', 'name', 'country', 'region', 'latitude', 'longitude'] as const).map(
                (field) => (
                  <label key={field}>
                    {t(
                      field === 'id'
                        ? '城市标识'
                        : field === 'name'
                          ? '城市名称'
                          : field === 'country'
                            ? '国家'
                            : field === 'region'
                              ? '省份或地区'
                              : field === 'latitude'
                                ? '城市代表纬度'
                                : '城市代表经度',
                    )}
                    <input
                      type={field === 'latitude' || field === 'longitude' ? 'number' : 'text'}
                      step="any"
                      value={city[field]}
                      onChange={(e) => {
                        setEdited(true);
                        setCity({
                          ...city,
                          [field]:
                            field === 'latitude' || field === 'longitude'
                              ? Number(e.target.value)
                              : e.target.value,
                        });
                      }}
                    />
                  </label>
                ),
              )}
            </details>
          )}
          <div className={styles.actions}>
            <button
              disabled={busy || disabled}
              onClick={() =>
                void perform(() =>
                  edited && city
                    ? reviewPhotoAgentSuggestion(task.id, s.id, 'ACCEPT', city)
                    : reviewPhotoAgentSuggestion(task.id, s.id, 'ACCEPT'),
                )
              }
            >
              {t('接受建议')}
            </button>
            <button
              disabled={busy || disabled}
              onClick={() =>
                void perform(() => reviewPhotoAgentSuggestion(task.id, s.id, 'REJECT'))
              }
            >
              {t('拒绝建议')}
            </button>
          </div>
        </>
      )}
      {s.status === 'ACCEPTED' && (
        <button
          disabled={busy}
          onClick={() => void perform(() => undoPhotoAgentSuggestion(task.id, s.id))}
        >
          {t('撤销本项操作')}
        </button>
      )}
    </article>
  );
}
