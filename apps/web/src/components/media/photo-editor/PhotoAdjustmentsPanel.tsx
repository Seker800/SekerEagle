import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconRotateClockwise } from '@tabler/icons-react';
import { t } from '../../../i18n';
import type { PhotoEdits } from './photo-editor-model';
import {
  ADJUSTMENT_GROUPS,
  PHOTO_ADJUSTMENTS,
  adjustmentValue,
  type AdjustmentGroup,
  type PhotoAdjustmentOption,
} from './photo-adjustment-catalog';
import styles from './PhotoEditor.module.css';
import { ScrollableToolRow } from './ScrollableToolRow';

export function PhotoAdjustmentsPanel({
  edits,
  disabled,
  canReset,
  onReset,
  renderControl,
  compareControl,
  onResetOption,
}: {
  edits: PhotoEdits;
  disabled: boolean;
  canReset: boolean;
  onReset: () => void;
  renderControl: (option: PhotoAdjustmentOption) => ReactNode;
  compareControl: ReactNode;
  onResetOption: (option: PhotoAdjustmentOption) => void;
}) {
  const [group, setGroup] = useState<AdjustmentGroup>('tone');
  const [selection, setSelection] = useState<Record<AdjustmentGroup, string>>({
    tone: 'exposure',
    color: 'saturation',
    detail: 'sharpen',
  });
  const options = PHOTO_ADJUSTMENTS.filter((option) => option.group === group);
  const selected = options.find((option) => option.id === selection[group]) ?? options[0];
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected.id]);
  return (
    <div className={styles.adjustmentsPanel}>
      <div className={styles.adjustmentCategoryRow}>
        <div className={styles.adjustmentGroups} role="group" aria-label={t('调整分类')}>
          {ADJUSTMENT_GROUPS.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={group === item.id}
              disabled={disabled}
              onClick={() => setGroup(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={disabled || !canReset}
          onClick={onReset}
          aria-label={t('重置全部')}
        >
          <IconRotateClockwise size={13} />
          {t('重置全部')}
        </button>
      </div>
      <ScrollableToolRow className={styles.adjustmentOptions} label={t('调整选项')}>
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            ref={selected.id === option.id ? selectedRef : undefined}
            disabled={disabled}
            aria-pressed={selected.id === option.id}
            aria-label={option.label}
            title={`${option.label} · ${t('双击重置此项')}`}
            onClick={() => setSelection((current) => ({ ...current, [group]: option.id }))}
            onDoubleClick={() => onResetOption(option)}
          >
            <span className={styles.optionValue} data-modified={edits[option.key] !== 0}>
              {adjustmentValue(option, edits)}
            </span>
            <span className={styles.optionName}>{option.label}</span>
          </button>
        ))}
      </ScrollableToolRow>
      <div className={styles.parameterInspector}>
        <div className={styles.parameterRow}>
          {compareControl}
          {renderControl(selected)}
        </div>
        <p className={styles.parameterHint}>{t('双击归零 · 方向键微调 · Shift 加速')}</p>
      </div>
    </div>
  );
}
