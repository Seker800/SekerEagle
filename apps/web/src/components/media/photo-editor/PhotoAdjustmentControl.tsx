import { useEffect, useRef, useState } from 'react';
import { t } from '../../../i18n';
import styles from './PhotoEditor.module.css';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  compact?: boolean;
  disabled: boolean;
  onChange: (value: number) => void;
  onStart: () => void;
  onCommit: () => void;
  onReset: () => void;
}

/** Shared precision control for mouse, keyboard and touch. */
export function PhotoAdjustmentControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  compact,
  disabled,
  onChange,
  onStart,
  onCommit,
  onReset,
}: Props) {
  const decimals = step < 1 ? 2 : 0;
  const format = (number: number) => number.toFixed(decimals);
  const [draft, setDraft] = useState(format(value));
  const skipBlur = useRef(false);
  useEffect(() => {
    setDraft(value.toFixed(decimals));
  }, [value, decimals]);
  const normalize = (number: number) =>
    Number(Math.max(min, Math.min(max, Math.round(number / step) * step)).toFixed(decimals));
  function commitNumber() {
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) {
      const next = normalize(parsed);
      setDraft(format(next));
      if (next !== value) onChange(next);
    } else setDraft(format(value));
  }
  return (
    <div className={styles.slider} data-compact={compact || undefined}>
      <div className={styles.adjustmentHeading}>
        {!compact && (
          <button
            type="button"
            className={styles.adjustmentLabel}
            onDoubleClick={onReset}
            disabled={disabled}
            title={t('双击重置此项')}
          >
            {label}
            {unit && <span aria-hidden="true"> ({unit})</span>}
          </button>
        )}
        <input
          type="number"
          className={styles.numberInput}
          aria-label={t('{{value1}}数值', { value1: label })}
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (skipBlur.current) skipBlur.current = false;
            else commitNumber();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitNumber();
              skipBlur.current = true;
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(format(value));
              skipBlur.current = true;
              event.currentTarget.blur();
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              const next = normalize(
                value + (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1),
              );
              setDraft(format(next));
              onChange(next);
            }
          }}
        />
      </div>
      <div className={styles.precisionRow}>
        <button
          type="button"
          aria-label={t('减小{{value1}}', { value1: label })}
          disabled={disabled || value <= min}
          onClick={() => onChange(normalize(value - step))}
        >
          −
        </button>
        <input
          type="range"
          aria-label={label}
          aria-valuetext={unit ? `${format(value)} ${unit}` : undefined}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onPointerDown={onStart}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={onCommit}
          onPointerCancel={onCommit}
          onKeyUp={onCommit}
          onBlur={onCommit}
          onDoubleClick={onReset}
          onKeyDown={(event) => {
            const direction = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(event.key)
              ? 1
              : ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key)
                ? -1
                : 0;
            if (direction) {
              event.preventDefault();
              onStart();
              const multiplier = event.shiftKey || event.key.startsWith('Page') ? 10 : 1;
              onChange(normalize(value + direction * step * multiplier));
            }
            if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              onStart();
              onChange(event.key === 'Home' ? min : max);
            }
          }}
        />
        <button
          type="button"
          aria-label={t('增加{{value1}}', { value1: label })}
          disabled={disabled || value >= max}
          onClick={() => onChange(normalize(value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}
