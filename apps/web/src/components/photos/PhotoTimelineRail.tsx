import { useMemo, useRef, useState } from 'react';
import { IconArrowUp, IconRefresh } from '@tabler/icons-react';
import { getLocale, t } from '../../i18n';
import type { PhotoTimelineMonth } from '../../lib/photo-management-api';
import styles from './PhotoTimelineRail.module.css';
import { buildPhotoTimelineScale } from './photo-timeline-scale';

interface Props {
  months: PhotoTimelineMonth[];
  currentMonth?: string;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onJump: (month: PhotoTimelineMonth) => void;
  onLatest: () => void;
}
export function PhotoTimelineRail({
  months,
  currentMonth,
  loading,
  error,
  onRetry,
  onJump,
  onLatest,
}: Props) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const clearHover = () => {
    setHovered(null);
    setHoverPosition(null);
  };
  const current = Math.max(
    0,
    months.findIndex((month) => month.month === currentMonth),
  );
  const selected = Math.min(hovered ?? current, Math.max(0, months.length - 1));
  const scale = useMemo(() => buildPhotoTimelineScale(months), [months]);
  const position = (index: number) => scale.positions[index];
  const dateFormat = new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const format = (month: PhotoTimelineMonth) =>
    dateFormat.format(new Date(`${month.month}-01T00:00:00Z`));
  const indexAt = (y: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const target = Math.max(0, Math.min(100, ((y - rect.top) / Math.max(1, rect.height)) * 100));
    return months.reduce(
      (nearest, _, index) =>
        Math.abs(position(index) - target) < Math.abs(position(nearest) - target) ? index : nearest,
      0,
    );
  };
  // Reserve room for endpoint dates and avoid collisions without removing navigable ticks.
  const labels = scale.years.reduce<typeof scale.years>((visible, label) => {
    const previous = visible.at(-1)?.top ?? 0;
    if (label.top > 6.5 && label.top < 93.5 && label.top - previous >= 7) visible.push(label);
    return visible;
  }, []);
  const ticks = months
    .map(({ month, count }, index) => ({
      month,
      count,
      top: position(index),
      major: index === 0 || !month.startsWith(months[index - 1].month.slice(0, 4)),
    }))
    .filter(({ count }) => count > 0);
  const influenceAt = (top: number) =>
    hoverPosition === null ? 0 : Math.max(0, 1 - Math.abs(top - hoverPosition) / 8) ** 2;
  const selectHover = (index: number, top = position(index)) => {
    setHovered(index);
    setHoverPosition(top);
  };
  return (
    <aside className={styles.rail} aria-label={t('照片日期导航')}>
      <button
        type="button"
        aria-label={t('回到最新照片')}
        title={t('回到最新照片')}
        onClick={onLatest}
      >
        <IconArrowUp size={16} />
      </button>
      {loading ? (
        <small role="status">{t('正在加载…')}</small>
      ) : error ? (
        <button
          type="button"
          aria-label={t('重试日期导航')}
          title={t('重试日期导航')}
          onClick={onRetry}
        >
          <IconRefresh size={16} />
        </button>
      ) : months.length > 0 ? (
        <div
          className={styles.frame}
          onPointerLeave={clearHover}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) clearHover();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              sliderRef.current?.focus();
              clearHover();
            }
          }}
        >
          <div
            ref={sliderRef}
            className={styles.track}
            role="slider"
            tabIndex={0}
            aria-label={t('按年月跳转')}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={months.length - 1}
            aria-valuenow={selected}
            aria-valuetext={format(months[selected])}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              selectHover(
                indexAt(event.clientY, event.currentTarget),
                Math.max(
                  0,
                  Math.min(100, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100),
                ),
              );
            }}
            onFocus={() => selectHover(current)}
            onClick={(event) => {
              const index = indexAt(event.clientY, event.currentTarget);
              selectHover(index);
              onJump(months[index]);
            }}
            onKeyDown={(event) => {
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? months.length - 1
                    : event.key === 'ArrowDown'
                      ? Math.min(months.length - 1, selected + 1)
                      : event.key === 'ArrowUp'
                        ? Math.max(0, selected - 1)
                        : null;
              if (next === null) return;
              event.preventDefault();
              selectHover(next);
              onJump(months[next]);
            }}
          >
            {ticks.map(({ month, major, top }) => {
              const influence = influenceAt(top);
              return (
                <i
                  key={month}
                  className={styles.tick}
                  data-ruler-month={month}
                  data-major={major}
                  style={{
                    top: `${top}%`,
                    width: (major ? 10 : 4) + influence * 16,
                    opacity: 0.45 + influence * 0.55,
                    transform: `scaleY(${1 + influence})`,
                  }}
                  aria-hidden="true"
                />
              );
            })}
            {[0, ...(months.length > 1 ? [months.length - 1] : [])].map((index) => (
              <time
                key={months[index].month}
                className={styles.year}
                dateTime={months[index].month}
                style={{ top: `${position(index)}%` }}
              >
                {months[index].month.replace('-', '/')}
              </time>
            ))}
            {scale.breaks.map(({ newerYear, olderYear, top }) => (
              <span
                key={`${newerYear}-${olderYear}`}
                className={styles.break}
                data-testid="timeline-break"
                style={{ top: `${top}%` }}
                aria-hidden="true"
              >
                ≈
              </span>
            ))}
            {labels.map(({ year, top }) => (
              <span
                key={year}
                data-ruler-year={year}
                className={styles.year}
                style={{
                  top: `${top}%`,
                  opacity: hovered !== null && Math.abs(top - (hoverPosition ?? 0)) < 3 ? 0 : 1,
                }}
                aria-hidden="true"
              >
                {year}
              </span>
            ))}
            <i
              className={styles.indicator}
              data-current-month={currentMonth}
              style={{ top: `${position(current)}%` }}
              aria-hidden="true"
            />
          </div>
          {hovered !== null && (
            <time
              role="tooltip"
              dateTime={months[selected].month}
              className={styles.hoverDate}
              style={{ top: `${hoverPosition ?? position(selected)}%` }}
            >
              {format(months[selected])}
              <small>{t('{{value1}} 张照片', { value1: months[selected].count })}</small>
            </time>
          )}
        </div>
      ) : null}
    </aside>
  );
}
