import { useState } from 'react';
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
  const position = (index: number) =>
    latest > earliest
      ? ((latest - monthNumber(months[index].month)) / (latest - earliest)) * 100
      : 0;
  const format = (month: PhotoTimelineMonth) =>
    new Intl.DateTimeFormat(getLocale(), {
      year: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${month.month}-01T00:00:00Z`));
  const indexAt = (y: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const target = Math.max(0, Math.min(100, ((y - rect.top) / Math.max(1, rect.height)) * 100));
    return months.reduce(
      (nearest, _, index) =>
        Math.abs(position(index) - target) < Math.abs(position(nearest) - target) ? index : nearest,
      0,
    );
  };
  const years = months.flatMap((month, index) =>
    index === 0 || month.month.slice(0, 4) !== months[index - 1].month.slice(0, 4)
      ? [{ year: month.month.slice(0, 4), index }]
      : [],
  );
  const stride = Math.max(1, Math.ceil(years.length / 12));
  const labels = years
    .filter(
      (year, index) =>
        index % stride === 0 && position(year.index) > 6.5 && position(year.index) < 93.5,
    )
    .reduce<typeof years>((visible, year) => {
      const previous = visible.at(-1);
      if (!previous || position(year.index) - position(previous.index) >= 6.5) visible.push(year);
      return visible;
    }, []);
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
          onPointerLeave={() => setHovered(null)}
          onFocus={() => setHovered(current)}
          onBlur={() => setHovered(null)}
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
          {labels.map(({ year, index }) => (
            <span
              key={year}
              className={styles.year}
              style={{ top: `${position(index)}%` }}
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
          {hovered !== null && (
            <div
              role="tooltip"
              className={styles.tooltip}
              style={{ top: `${position(selected)}%` }}
            >
              {format(months[selected])}
              <small>{t('{{value1}} 张照片', { value1: months[selected].count })}</small>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}
