import { useRef, useState } from 'react';
import { IconArrowUp, IconRefresh } from '@tabler/icons-react';
import { getLocale, t } from '../../i18n';
import type { PhotoTimelineMonth } from '../../lib/photo-management-api';
import styles from './PhotoTimelineRail.module.css';

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
  const current = Math.max(
    0,
    months.findIndex((month) => month.month === currentMonth),
  );
  const selected = Math.min(hovered ?? current, Math.max(0, months.length - 1));
  const monthNumber = (month: string) => {
    const [year, number] = month.split('-').map(Number);
    return year * 12 + number - 1;
  };
  const latest = months.length ? monthNumber(months[0].month) : 0;
  const earliest = months.length ? monthNumber(months[months.length - 1].month) : latest;
  const calendarPosition = (month: string) =>
    latest > earliest ? ((latest - monthNumber(month)) / (latest - earliest)) * 100 : 0;
  const position = (index: number) => calendarPosition(months[index].month);
  const dateFormat = new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const monthFormat = new Intl.DateTimeFormat(getLocale(), { month: 'short', timeZone: 'UTC' });
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
  // Calendar boundaries, not the first available photo in each year, define the scale.
  const newestYear = Math.floor(latest / 12);
  const oldestYear = Math.floor(earliest / 12);
  const stride = Math.max(1, Math.ceil((newestYear - oldestYear + 1) / 12));
  const labels = Array.from(
    { length: Math.floor((newestYear - oldestYear) / stride) + 1 },
    (_, index) => {
      const year = newestYear - index * stride;
      return { year, top: calendarPosition(`${year}-01`) };
    },
  ).filter(({ top }) => top > 6.5 && top < 93.5);
  const pickerYear = months[selected]?.month.slice(0, 4);
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
          onPointerLeave={() => setHovered(null)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              sliderRef.current?.focus();
              setHovered(null);
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
            onPointerMove={(event) => setHovered(indexAt(event.clientY, event.currentTarget))}
            onFocus={() => setHovered(current)}
            onClick={(event) => {
              const index = indexAt(event.clientY, event.currentTarget);
              setHovered(index);
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
              setHovered(next);
              onJump(months[next]);
            }}
          >
            {months.map((month, index) => (
              <i
                key={month.month}
                className={styles.tick}
                style={{ top: `${position(index)}%` }}
                aria-hidden="true"
              />
            ))}
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
            {labels.map(({ year, top }) => (
              <span
                key={year}
                className={`${styles.year} ${styles.calendarYear}`}
                onPointerMove={(event) => {
                  const index = months.findIndex((month) => month.month.startsWith(`${year}-`));
                  if (index >= 0) {
                    event.stopPropagation();
                    setHovered(index);
                  }
                }}
                style={{ top: `${top}%` }}
                aria-hidden="true"
              >
                {year}
              </span>
            ))}
            <i
              className={styles.indicator}
              style={{ top: `${position(current)}%` }}
              aria-hidden="true"
            />
          </div>
          {hovered !== null && (
            <div
              className={styles.monthPicker}
              style={{ top: `clamp(90px, ${position(selected)}%, calc(100% - 90px))` }}
            >
              <div role="tooltip" className={styles.tooltip}>
                {format(months[selected])}
                <small>{t('{{value1}} 张照片', { value1: months[selected].count })}</small>
              </div>
              <nav className={styles.months} aria-label={t('按年月跳转')}>
                {Array.from({ length: 12 }, (_, index) => {
                  const key = `${pickerYear}-${String(index + 1).padStart(2, '0')}`;
                  const available = months.findIndex((month) => month.month === key);
                  const date = new Date(`${key}-01T00:00:00Z`);
                  return (
                    <button
                      type="button"
                      key={key}
                      aria-label={dateFormat.format(date)}
                      aria-current={currentMonth === key ? 'date' : undefined}
                      data-selected={months[selected].month === key}
                      disabled={available < 0}
                      onClick={() => {
                        setHovered(available);
                        onJump(months[available]);
                      }}
                    >
                      {monthFormat.format(date)}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}
