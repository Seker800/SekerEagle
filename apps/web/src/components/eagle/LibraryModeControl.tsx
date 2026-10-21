import { IconPhoto, IconLayoutGrid } from '@tabler/icons-react';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import type { LibraryMode } from '../../lib/library-api-scope';
import { t } from '../../i18n';
import styles from './LibraryModeSwitcher.module.css';
export function LibraryModeControl({
  value,
  onChange,
}: {
  value: LibraryMode;
  onChange: (mode: LibraryMode) => void;
}) {
  const compact = useCompactLayout();
  return (
    <nav aria-label={t('图库模式')} className={compact ? styles.phoneSwitcher : styles.switcher}>
      {(compact ? (['PHOTO', 'MATERIAL'] as const) : (['MATERIAL', 'PHOTO'] as const)).map(
        (mode) => (
          <button
            key={mode}
            type="button"
            className={styles.option}
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
          >
            {compact &&
              (mode === 'PHOTO' ? (
                <IconPhoto size={18} stroke={1.7} />
              ) : (
                <IconLayoutGrid size={18} stroke={1.7} />
              ))}
            <span>{mode === 'PHOTO' ? t('照片') : t('素材')}</span>
          </button>
        ),
      )}
    </nav>
  );
}
