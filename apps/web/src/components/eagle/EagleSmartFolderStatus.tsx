import type { EagleSmartFolder } from '../../lib/eagle-api';
import { t } from '../../i18n';
import styles from './EagleSmartFolderStatus.module.css';

export function EagleSmartFolderStatus({
  state,
  order,
  pending,
  onRetry,
  onOrderChange,
}: {
  state: EagleSmartFolder['semanticState'];
  order: 'DATE' | 'RELEVANCE';
  pending: boolean;
  onRetry: () => void;
  onOrderChange: (order: 'DATE' | 'RELEVANCE') => void;
}) {
  if (!state) return null;
  const message =
    state.status === 'FAILED'
      ? state.hasResults
        ? t('匹配更新失败，已保留上一版。')
        : t('匹配生成失败，请重试。')
      : state.status === 'READY'
        ? t('新照片会自动加入')
        : state.hasResults
          ? t('正在更新匹配结果，仍可浏览上一版。')
          : t('正在生成匹配结果…');
  return (
    <div className={styles.status}>
      <span role="status">{message}</span>
      {state.status === 'FAILED' ? (
        <button type="button" disabled={pending} onClick={onRetry}>
          {t('重新生成匹配结果')}
        </button>
      ) : null}
      <select
        aria-label={t('智能文件夹排序')}
        value={order}
        onChange={(event) => onOrderChange(event.target.value as 'DATE' | 'RELEVANCE')}
      >
        <option value="DATE">{t('按日期')}</option>
        <option value="RELEVANCE">{t('按相关度')}</option>
      </select>
    </div>
  );
}
