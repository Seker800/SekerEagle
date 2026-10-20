import { t } from '../../i18n';
import styles from './EagleSortSummary.module.css';
export function EagleSortSummary({ dateKind }: { dateKind: 'capture' | 'added' }) {
  return (
    <p className={styles.summary}>
      <span>{dateKind === 'capture' ? t('拍摄时间 · 最新优先') : t('添加时间 · 最新优先')}</span>
      {dateKind === 'capture' && <small>{t('无拍摄时间时使用添加时间')}</small>}
    </p>
  );
}
