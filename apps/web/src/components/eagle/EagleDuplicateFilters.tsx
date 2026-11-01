import type { DuplicateFilters } from '../../lib/eagle-duplicates-api';
import { t } from '../../i18n';
import styles from './EagleDuplicates.module.css';
export function EagleDuplicateFilters({
  value,
  onChange,
}: {
  value: DuplicateFilters;
  onChange: (value: DuplicateFilters) => void;
}) {
  const conditions = [
    ['sameName', t('文件名相同')],
    ['sameCapturedAt', t('拍摄时间相同')],
    ['sameDimensions', t('尺寸相同')],
    ['sameFormat', t('格式相同')],
    ['sameBytes', t('文件大小相同')],
  ] as const;

  return (
    <fieldset className={styles.filters}>
      <legend>{t('同时满足以下条件')}</legend>
      <div>
        {conditions.map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={value[key] === 'true'}
              onChange={(e) => onChange({ ...value, [key]: e.target.checked ? 'true' : undefined })}
            />
            {label}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={!!value.maxBytes}
            onChange={(e) =>
              onChange({ ...value, maxBytes: e.target.checked ? '10485760' : undefined })
            }
          />
          {t('每张文件都小于')}
        </label>
        <input
          aria-label={t('文件大小上限（MB）')}
          type="number"
          min="0"
          step="any"
          key={value.maxBytes ? 'enabled' : 'disabled'}
          disabled={!value.maxBytes}
          defaultValue={Number(value.maxBytes ?? 10485760) / 1048576}
          onChange={(e) => {
            const mb = Number(e.target.value);
            const bytes = Math.round(mb * 1048576);
            if (mb > 0 && bytes > 0 && Number.isSafeInteger(bytes))
              onChange({ ...value, maxBytes: String(bytes) });
          }}
          onBlur={(e) => {
            const bytes = Math.round(Number(e.currentTarget.value) * 1048576);
            if (bytes <= 0 || !Number.isSafeInteger(bytes))
              e.currentTarget.value = String(Number(value.maxBytes ?? 10485760) / 1048576);
          }}
        />{' '}
        MB
        <label>
          <input
            type="checkbox"
            checked={value.protectEdits === 'true'}
            onChange={(e) =>
              onChange({ ...value, protectEdits: e.target.checked ? 'true' : undefined })
            }
          />
          {t('保护已知编辑版本')}
        </label>
      </div>
      <button type="button" onClick={() => onChange({ protectEdits: 'true' })}>
        {t('还原默认条件')}
      </button>
      <small>
        {t(
          '条件作用于组内每张原文件；缺少拍摄时间不算相同。编辑保护依据系统记录，不能识别所有外部修图。',
        )}
      </small>
    </fieldset>
  );
}
