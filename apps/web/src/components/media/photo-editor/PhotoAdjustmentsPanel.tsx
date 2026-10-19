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
import { PhotoAdvancedAdjustments } from './PhotoAdvancedAdjustments';
import { ScrollableToolRow } from './ScrollableToolRow';

export function PhotoAdjustmentsPanel({
  edits,
  disabled,
  canReset,
  onReset,
  renderControl,
  compareControl,
  onResetOption,
  onChangeOption,
  onGestureStart,
  onGestureCommit,
}: {
  edits: PhotoEdits;
  disabled: boolean;
  canReset: boolean;
  onReset: () => void;
  renderControl: (option: PhotoAdjustmentOption) => ReactNode;
  compareControl: ReactNode;
  onResetOption: (option: PhotoAdjustmentOption) => void;
  onChangeOption: (key: PhotoAdjustmentOption['key'], value: number) => void;
  onGestureStart: () => void;
  onGestureCommit: () => void;
}) {
  const [group, setGroup] = useState<AdjustmentGroup>('tone');
  const [selection, setSelection] = useState<Record<AdjustmentGroup, string>>({
    tone: 'exposure',
    color: 'saturation',
    detail: 'sharpen',
    hsl: 'hslRedHue',
    curves: 'curveMaster2',
    grading: 'gradeShadowsHue',
  });
  const basicGroups = ['tone', 'color', 'detail'];
  const basic = basicGroups.includes(group);
  const options = PHOTO_ADJUSTMENTS.filter((option) => option.group === group);
  const visibleOptions = basic
    ? PHOTO_ADJUSTMENTS.filter((option) => basicGroups.includes(option.group))
    : options;
  const viewportRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const manualScroll = useRef(false);
  const [visibleGroup, setVisibleGroup] = useState<AdjustmentGroup>('tone');
  const selectGroup = (next: AdjustmentGroup) => {
    manualScroll.current = false;
    setGroup(next);
    setVisibleGroup(next);
    requestAnimationFrame(() => {
      const first = PHOTO_ADJUSTMENTS.find((option) => option.group === next);
      const button = first && buttons.current.get(first.id);
      const viewport = viewportRef.current;
      if (button && viewport)
        viewport.scrollTo?.({
          left:
            viewport.scrollLeft +
            button.getBoundingClientRect().left -
            viewport.getBoundingClientRect().left,
          behavior: 'smooth',
        });
    });
  };
  const selected = options.find((option) => option.id === selection[group]) ?? options[0];
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected.id]);
  return (
    <div className={styles.adjustmentsPanel}>
      <div className={styles.adjustmentCategoryRow}>
        <ScrollableToolRow className={styles.adjustmentGroups} label={t('调整分类')}>
          {ADJUSTMENT_GROUPS.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={visibleGroup === item.id}
              disabled={disabled}
              onClick={() => selectGroup(item.id)}
            >
              {item.label}
            </button>
          ))}
        </ScrollableToolRow>
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
      {group === 'hsl' || group === 'curves' || group === 'grading' ? (
        <PhotoAdvancedAdjustments
          group={group}
          options={options}
          selected={selected}
          edits={edits}
          disabled={disabled}
          onSelect={(option) => setSelection((current) => ({ ...current, [group]: option.id }))}
          onChange={onChangeOption}
          onStart={onGestureStart}
          onCommit={onGestureCommit}
        />
      ) : (
        <ScrollableToolRow
          className={styles.adjustmentOptions}
          label={t('调整选项')}
          viewportRef={viewportRef}
          onNavigate={() => {
            manualScroll.current = true;
          }}
          onScroll={(viewport) => {
            if (!manualScroll.current || viewport.scrollWidth <= viewport.clientWidth + 1) return;
            const left = viewport.getBoundingClientRect().left + 8;
            const leading = visibleOptions.find((option) => {
              const button = buttons.current.get(option.id);
              return button && button.getBoundingClientRect().right > left;
            });
            if (leading) setVisibleGroup(leading.group);
          }}
        >
          {visibleOptions.map((option) => (
            <button
              type="button"
              key={option.id}
              ref={(button) => {
                if (button) buttons.current.set(option.id, button);
                else buttons.current.delete(option.id);
                if (selected.id === option.id) selectedRef.current = button;
              }}
              disabled={disabled}
              aria-pressed={selected.id === option.id}
              aria-label={option.label}
              title={`${option.label} · ${t('双击重置此项')}`}
              onClick={() => {
                setGroup(option.group);
                setVisibleGroup(option.group);
                setSelection((current) => ({ ...current, [option.group]: option.id }));
              }}
              onDoubleClick={() => onResetOption(option)}
            >
              <span className={styles.optionValue} data-modified={edits[option.key] !== 0}>
                {adjustmentValue(option, edits)}
              </span>
              <span className={styles.optionName}>{option.label}</span>
            </button>
          ))}
        </ScrollableToolRow>
      )}
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
