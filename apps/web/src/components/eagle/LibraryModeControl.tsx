import { IconChevronDown } from '@tabler/icons-react';
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
  if (compact)
    return (
      <label className={styles.dropdown}>
        <select
          aria-label={t('图库模式')}
          value={value}
          onChange={(event) => onChange(event.target.value as LibraryMode)}
        >
          <option value="PHOTO">{t('相册')}</option>
          <option value="MATERIAL">{t('素材')}</option>
        </select>
        <IconChevronDown size={17} />
      </label>
    );
  return (
    <nav aria-label={t('图库模式')} className={styles.switcher}>
      {(['MATERIAL', 'PHOTO'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={styles.option}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {mode === 'PHOTO' ? t('照片') : t('素材')}
        </button>
      ))}
    </nav>
  );
}
