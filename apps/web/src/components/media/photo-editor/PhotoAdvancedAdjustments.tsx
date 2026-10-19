import { useEffect, useRef, type PointerEvent } from 'react';
import { t } from '../../../i18n';
import type { PhotoEdits } from './photo-editor-model';
import type { PhotoAdjustmentOption, AdvancedAdjustmentGroup } from './photo-adjustment-catalog';
import {
  curveKey,
  CURVE_POINTS,
  type CurveChannel,
  type CurvePoint,
} from './photo-editor-advanced-model';
import { photoCurveLut } from './photo-editor-color-mixer';
import { ScrollableToolRow } from './ScrollableToolRow';
import styles from './PhotoEditor.module.css';

export function PhotoAdvancedAdjustments({
  group,
  options,
  selected,
  edits,
  disabled,
  onSelect,
  onChange,
  onStart,
  onCommit,
}: {
  group: AdvancedAdjustmentGroup;
  options: readonly PhotoAdjustmentOption[];
  selected: PhotoAdjustmentOption;
  edits: PhotoEdits;
  disabled: boolean;
  onSelect: (option: PhotoAdjustmentOption) => void;
  onChange: (key: PhotoAdjustmentOption['key'], value: number) => void;
  onStart: () => void;
  onCommit: () => void;
}) {
  const selectedFamily = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ point: CurvePoint; pointer: number; rect: DOMRect } | null>(null);
  const latestCommit = useRef(onCommit);
  latestCommit.current = onCommit;
  useEffect(
    () => () => {
      if (drag.current) latestCommit.current();
    },
    [],
  );
  useEffect(() => {
    selectedFamily.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected.family]);
  const families = options.filter(
    (option, i) => options.findIndex((o) => o.family === option.family) === i,
  );
  const axes = options.filter((o) => o.family === selected.family);
  const channel = selected.family as CurveChannel;
  const lut = group === 'curves' ? photoCurveLut(edits, channel) : null;
  const end = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return;
    drag.current = null;
    onCommit();
  };
  const move = (y: number) => {
    const active = drag.current;
    if (!active) return;
    const position = Math.max(0, Math.min(1, 1 - (y - active.rect.top) / active.rect.height));
    onChange(curveKey(channel, active.point), Math.round((position - active.point / 4) * 100));
  };
  return (
    <div className={styles.advancedOptions}>
      <ScrollableToolRow className={styles.advancedFamilies} label={t('分色通道')}>
        {families.map((family) => (
          <button
            key={family.family}
            ref={family.family === selected.family ? selectedFamily : undefined}
            type="button"
            aria-label={family.familyLabel}
            aria-pressed={family.family === selected.family}
            disabled={disabled}
            onClick={() => {
              onSelect(
                options.find(
                  (o) => o.family === family.family && o.axisLabel === selected.axisLabel,
                ) ?? family,
              );
            }}
          >
            {group === 'hsl' ? (
              <span
                className={styles.colorDot}
                style={{ background: family.familyColor }}
                aria-hidden="true"
              />
            ) : null}
            <span>{family.familyLabel}</span>
          </button>
        ))}
      </ScrollableToolRow>
      {lut && (
        <svg
          className={styles.curveGraph}
          viewBox="0 0 256 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={t('曲线编辑')}
          onPointerDown={(event) => {
            if (disabled || drag.current || (event.pointerType === 'mouse' && event.button !== 0))
              return;
            const rect = event.currentTarget.getBoundingClientRect();
            const point = Math.max(
              0,
              Math.min(4, Math.round(((event.clientX - rect.left) / rect.width) * 4)),
            ) as CurvePoint;
            onSelect(options.find((o) => o.key === curveKey(channel, point))!);
            onStart();
            drag.current = { point, pointer: event.pointerId, rect };
            event.currentTarget.setPointerCapture(event.pointerId);
            move(event.clientY);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointer === event.pointerId) move(event.clientY);
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
        >
          {[25, 50, 75].map((p) => (
            <path key={p} d={`M ${p * 2.56} 0 V100 M0 ${p} H256`} className={styles.curveGrid} />
          ))}
          <path d="M0 100 L256 0" className={styles.curveIdentity} />
          <polyline
            points={Array.from(lut, (value, x) => `${x},${100 - (value / 255) * 100}`).join(' ')}
            className={styles.curveLine}
          />
          {CURVE_POINTS.map((point) => (
            <circle
              key={point}
              cx={point * 64}
              cy={
                100 -
                Math.max(0, Math.min(1, point / 4 + edits[curveKey(channel, point)] / 100)) * 100
              }
              r={selected.key === curveKey(channel, point) ? 4 : 2.5}
              className={styles.curveNode}
            />
          ))}
        </svg>
      )}
      <div className={styles.advancedAxes} role="group" aria-label={t('调整维度')}>
        {axes.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected.id === option.id}
            disabled={disabled}
            onClick={() => onSelect(option)}
            aria-label={option.axisLabel}
            title={option.label}
          >
            <span>{option.axisLabel}</span>
            <small>
              {edits[option.key] > 0 ? '+' : ''}
              {edits[option.key]}
            </small>
          </button>
        ))}
      </div>
      {lut && <p className={styles.parameterHint}>{t('拖动节点或使用滑杆调整曲线')}</p>}
    </div>
  );
}
