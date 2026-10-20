import { IconLayersIntersect } from '@tabler/icons-react';
import { t } from '../../i18n';
import styles from './EagleStackBadge.module.css';

export function EagleStackBadge({ count }: { count: number }) {
  if (count < 2) return null;
  const label = t('照片组，共 {{value1}} 张', { value1: count });
  return (
    <span className={styles.badge} role="img" aria-label={label} title={label}>
      <IconLayersIntersect size={14} aria-hidden="true" />
      <span>{count}</span>
    </span>
  );
}
