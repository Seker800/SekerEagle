import {useState, type ReactNode} from 'react';
import {type BackgroundSchedule, type TaskGroup, type TaskCenterOverview} from '@sekereagle/library-core';
import {t} from '../../i18n';
import type {LibraryMode} from '../../lib/library-api-scope';
import {taskFamilyLabels, taskStepLabel, taskWaitLabel, taskStatus, taskStatusLabel} from './task-center-labels';
import styles from './TaskQueueBrowser.module.css';
export interface TaskQueueItem {
  mode: LibraryMode; group: TaskGroup; schedule: BackgroundSchedule; embedding?: TaskCenterOverview['embedding'];
}
const keyFor = (item: TaskQueueItem) => `${item.mode}:${item.group.id}`;
/** Navigation and formatting only. Execution decisions arrive in each group's server presentation. */
export function TaskQueueBrowser({items, renderDetails}: {items: TaskQueueItem[]; renderDetails: (item: TaskQueueItem) => ReactNode}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [selected, setSelected] = useState<string | null>(null);
  const visible = items.filter((item) => {
    const labels = [taskFamilyLabels(item.group.id)[0], ...item.group.steps.map((step) => taskStepLabel(step.id))].join(' ').toLocaleLowerCase();
    return labels.includes(search.trim().toLocaleLowerCase()) && (status === 'ALL' || taskStatus(item.group, item.schedule, item.embedding) === status);
  });
  const current = visible.find((item) => keyFor(item) === selected) ?? visible[0];
  return <section className={styles.browser} aria-label={t('后台工作')}>
    <div className={styles.filters}>
      <input type="search" aria-label={t('搜索类别或步骤')} placeholder={t('搜索类别或步骤')} value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label={t('筛选任务')} value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="ALL">{t('所有状态')}</option><option value="RUNNING">{t('运行中')}</option>
        <option value="QUEUED">{t('排队ing')}</option><option value="WAITING">{t('等待执行')}</option>
        <option value="STOPPED">{t('已停止')}</option><option value="COMPLETED">{t('已完成')}</option>
      </select>
    </div>
    <div className={styles.workspace}>
      <div className={styles.list}>
        <table aria-label={t('后台工作')}>
          <thead><tr><th>{t('类别')}</th><th>{t('状态')}</th><th>{t('排队')}</th><th>{t('执行')}</th><th>{t('失败')}</th><th>{t('等待原因')}</th></tr></thead>
          <tbody>{visible.map((item) => {
            const {group, schedule, embedding, mode} = item;
            const reason = group.presentation?.reason ?? group.waiting.find((wait) => wait.reason !== 'QUEUED')?.reason;
            const running = group.steps.filter((step) => step.running > 0);
            return <tr key={keyFor(item)} aria-selected={current && keyFor(current) === keyFor(item)} data-state={taskStatus(group, schedule, embedding)}>
              <th scope="row"><button type="button" aria-pressed={current && keyFor(current) === keyFor(item)} onClick={() => setSelected(keyFor(item))}>
                <strong>{taskFamilyLabels(group.id)[0]}</strong><span className={styles.mode}>{mode === 'PHOTO' ? t('照片') : t('素材')}</span>
                {running.length > 0 && <small>{running.map((step) => taskStepLabel(step.id)).join(' · ')}</small>}
              </button></th>
              <td className={styles.state}>{group.id === 'APPROVALS' ? `${t('待审批')} ${group.approval}` : taskStatusLabel(group, schedule, embedding)}</td>
              <td className={styles.number}>{group.queued}</td><td className={styles.number}>{group.running}</td><td className={styles.number} data-error={group.failed > 0}>{group.failed}</td>
              <td className={styles.reason}>{reason ? taskWaitLabel(reason) : '—'}</td>
            </tr>;
          })}</tbody>
        </table>
        {!visible.length && <p>{t('未找到匹配任务')}</p>}
      </div>
      {current && <aside className={styles.inspector} aria-label={t('任务详情')} key={keyFor(current)}>{renderDetails(current)}</aside>}
    </div>
  </section>;
}
