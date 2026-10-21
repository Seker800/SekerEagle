import type { MouseEvent } from 'react';
import { IconCheck, IconDots, IconPhoto, IconX } from '@tabler/icons-react';
import { t } from '../../i18n';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import styles from './EagleSelectionToolbar.module.css';
export function EagleSelectionToolbar({
  selecting,
  count,
  onToggle,
  onActions,
  onPreview,
  onBatchEdit,
}: {
  selecting: boolean;
  count: number;
  onToggle: () => void;
  onActions: (event: MouseEvent<HTMLButtonElement>) => void;
  onPreview?: () => void;
  onBatchEdit?: () => void;
}) {
  const compact = useCompactLayout();
  const active = selecting || count > 0;
  return (
    <div
      className={`${styles.root} ${compact && !active ? styles.idle : ''}`}
      role="toolbar"
      aria-label={t('图片选择')}
    >
      <button type="button" aria-pressed={selecting} onClick={onToggle}>
        {selecting ? <IconX size={17} /> : <IconCheck size={17} />}
        {selecting ? t('取消选择') : t('选择')}
      </button>
      <span className={styles.count} aria-live="polite" aria-atomic="true">
        {count
          ? t('已选择 {{value1}} 项', { value1: count })
          : selecting
            ? t('点选要管理的图片')
            : ''}
      </span>
      {onPreview && (!compact || active) && (
        <button type="button" aria-label={t('查看所选图片')} onClick={onPreview}>
          <IconPhoto size={17} />
          {t('查看大图')}
        </button>
      )}
      {onBatchEdit && (!compact || active) && (
        <button type="button" disabled={!count} onClick={onBatchEdit}>
          {t('套用编辑参数')}
        </button>
      )}
      {(!compact || active) && (
        <button type="button" disabled={!count} aria-haspopup="menu" onClick={onActions}>
          <IconDots size={18} />
          {t('操作')}
        </button>
      )}
    </div>
  );
}
