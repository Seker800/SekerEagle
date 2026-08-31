import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { normalizeColorInput } from './eagle-color-input';
import styles from './EagleColorFilter.module.css';
const PRESETS = [
  [t('红色'), '#e5484d'],
  [t('橙色'), '#f28c28'],
  [t('黄色'), '#e5c247'],
  [t('绿色'), '#45a66b'],
  [t('青色'), '#2e86ab'],
  [t('蓝色'), '#4c6ef5'],
  [t('紫色'), '#8b5cf6'],
  [t('粉色'), '#db61a2'],
  [t('白色'), '#f2f2f2'],
  [t('灰色'), '#808080'],
  [t('黑色'), '#202124'],
] as const;
function hueColor(hue: number): string {
  return normalizeColorInput(`hsl(${hue}, 70%, 50%)`);
}
export function EagleColorFilter({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState('');
  useEffect(() => setDraft(value ?? ''), [value]);
  const apply = () => {
    try {
      const normalized = normalizeColorInput(draft);
      setDraft(normalized);
      setError('');
      onChange(normalized);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('颜色格式无效'));
    }
  };
  const choose = (color: string) => {
    setDraft(color);
    setError('');
    onChange(color);
  };
  return (
    <div className={styles.root}>
      <div className={styles.pickerRow}>
        <input
          className={styles.nativePicker}
          type="color"
          aria-label={t('打开颜色选择器')}
          value={value ?? '#2e86ab'}
          onChange={(event) => choose(event.target.value)}
        />
        <input
          className={styles.hue}
          type="range"
          min="0"
          max="359"
          defaultValue="197"
          aria-label={t('选择色相')}
          onChange={(event) => choose(hueColor(Number(event.target.value)))}
        />
      </div>
      <div className={styles.presets}>
        {PRESETS.map(([label, color]) => (
          <button
            key={color}
            type="button"
            aria-label={t('选择{{value1}}', {
              value1: label,
            })}
            aria-pressed={value === color}
            style={{ backgroundColor: color }}
            onClick={() => choose(color)}
          />
        ))}
      </div>
      <div className={styles.valueRow}>
        <span
          className={styles.preview}
          style={{ backgroundColor: (value ?? draft) || 'transparent' }}
        />
        <input
          aria-label={t('颜色值')}
          placeholder="#2e86ab / RGB / HSL"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
        />
        <button type="button" aria-label={t('应用颜色')} onClick={apply}>
          {' ' + t('应用') + ' '}
        </button>
        {value ? (
          <button type="button" aria-label={t('清除颜色筛选')} onClick={() => onChange(undefined)}>
            {' ' + t('清除') + ' '}
          </button>
        ) : null}
      </div>
      {error ? (
        <small className={styles.error} role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}
