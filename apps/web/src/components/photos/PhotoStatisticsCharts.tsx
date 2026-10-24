import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { PhotoStatisticsData, PhotoUsage } from '../../lib/photo-statistics-api';
import styles from './PhotoStatistics.module.css';

// Restrained tones plus dash patterns distinguish series without turning rankings into a rainbow.
const tones = [
  '#bac7d2',
  '#8ca5b8',
  '#708a9f',
  '#536f84',
  '#b6babc',
  '#929a9f',
  '#7d8d93',
  '#aab7ba',
  '#899b9c',
  '#657b82',
];
function seriesStyle(key: string | null, options: string[]) {
  const index = key === null ? options.length : Math.max(0, options.indexOf(key));
  return {
    color: tones[index] ?? `hsl(205 10% ${45 + ((index * 13) % 40)}%)`,
    dash: ['', '6 3', '2 3', '9 3 2 3'][index % 4],
  };
}
export const deviceLabel = (key: string | null, kind: 'camera' | 'lens') =>
  key === null ? t('其他设备（合并）') : key || (kind === 'camera' ? t('未知相机') : t('未知镜头'));

export function PhotoTimeChart({ data }: { data: PhotoStatisticsData }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string | null>>(new Set());
  const [highlight, setHighlight] = useState<string | null | undefined>();
  const [width, setWidth] = useState(1000);
  const frame = useRef<HTMLDivElement>(null);
  const description = useId();
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setWidth(Math.max(300, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [data.periods.length]);
  const keys = [...new Set(data.points.map((point) => point.key))];
  const values = new Map(
    data.points.map((point) => [JSON.stringify([point.period, point.key]), point.count]),
  );
  const count = (period: string, key: string | null) =>
    values.get(JSON.stringify([period, key])) ?? 0;
  const options = data.groupBy === 'camera' ? data.cameraOptions : data.lensOptions;
  const visible = keys.filter((key) => !hidden.has(key));
  const ceiling = Math.max(
    4,
    Math.ceil(
      Math.max(
        1,
        ...data.points.filter((point) => !hidden.has(point.key)).map((point) => point.count),
      ) / 4,
    ) * 4,
  );
  const height = 216,
    left = 32,
    right = 12,
    top = 12,
    bottom = 30;
  const x = (index: number) =>
    left +
    (data.periods.length > 1 ? index / (data.periods.length - 1) : 0.5) * (width - left - right);
  const y = (value: number) => height - bottom - (value / ceiling) * (height - top - bottom);
  const current = Math.min(
    selected ?? data.periods.length - 1,
    Math.max(0, data.periods.length - 1),
  );
  const tickCount = Math.min(width < 500 ? 4 : 7, data.periods.length);
  const ticks = new Set(
    Array.from({ length: tickCount }, (_, i) =>
      Math.round((i * (data.periods.length - 1)) / Math.max(1, tickCount - 1)),
    ),
  );
  return (
    <>
      <div className={styles.legend}>
        {keys.map((key) => {
          const style = seriesStyle(key, options);
          return (
            <button
              key={JSON.stringify(key)}
              type="button"
              aria-label={deviceLabel(key, data.groupBy)}
              aria-pressed={!hidden.has(key)}
              onPointerEnter={() => setHighlight(key)}
              onPointerLeave={() => setHighlight(undefined)}
              onFocus={() => setHighlight(key)}
              onBlur={() => setHighlight(undefined)}
              onClick={() =>
                setHidden((previous) => {
                  const next = new Set(previous);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
            >
              <i
                style={{
                  borderColor: style.color,
                  borderBottomStyle: style.dash ? 'dashed' : 'solid',
                }}
              />
              {deviceLabel(key, data.groupBy)}
            </button>
          );
        })}
      </div>
      {data.periods.length ? (
        <div ref={frame} className={styles.chartFrame}>
          <svg
            className={styles.timeChart}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            tabIndex={0}
            aria-label={t('拍摄量折线图')}
            aria-describedby={description}
            onFocus={() => setSelected((value) => value ?? data.periods.length - 1)}
            onBlur={() => setSelected(null)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              setSelected(
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? data.periods.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          data.periods.length - 1,
                          current + (event.key === 'ArrowLeft' ? -1 : 1),
                        ),
                      ),
              );
            }}
            onPointerLeave={() => setSelected(null)}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (rect.width)
                setSelected(
                  Math.max(
                    0,
                    Math.min(
                      data.periods.length - 1,
                      Math.round(
                        ((((event.clientX - rect.left) / rect.width) * width - left) /
                          (width - left - right)) *
                          (data.periods.length - 1),
                      ),
                    ),
                  ),
                );
            }}
          >
            {Array.from({ length: 5 }, (_, i) => (
              <g key={i}>
                <line
                  className={styles.grid}
                  x1={left}
                  x2={width - right}
                  y1={y((ceiling * i) / 4)}
                  y2={y((ceiling * i) / 4)}
                />
                <text x={left - 10} y={y((ceiling * i) / 4) + 4} textAnchor="end">
                  {(ceiling * i) / 4}
                </text>
              </g>
            ))}
            {data.periods.map((period, i) =>
              ticks.has(i) ? (
                <text
                  key={period}
                  x={x(i)}
                  y={height - 7}
                  textAnchor={i === 0 ? 'start' : i === data.periods.length - 1 ? 'end' : 'middle'}
                >
                  {period}
                </text>
              ) : null,
            )}
            {visible.map((key) => {
              const style = seriesStyle(key, options);
              return (
                <g
                  key={JSON.stringify(key)}
                  opacity={highlight === undefined || highlight === key ? 1 : 0.18}
                >
                  <polyline
                    fill="none"
                    stroke={style.color}
                    strokeDasharray={style.dash}
                    strokeWidth={highlight === key ? 2.4 : 1.6}
                    strokeLinejoin="round"
                    points={data.periods
                      .map((period, i) => `${x(i)},${y(count(period, key))}`)
                      .join(' ')}
                  />
                  {data.periods.length === 1 && (
                    <circle
                      cx={x(0)}
                      cy={y(count(data.periods[0], key))}
                      r="3"
                      fill={style.color}
                    />
                  )}
                </g>
              );
            })}
            {selected !== null && (
              <>
                <line
                  x1={x(current)}
                  x2={x(current)}
                  y1={top}
                  y2={height - bottom}
                  className={styles.cursor}
                />
                {visible.map((key) => (
                  <circle
                    key={JSON.stringify(key)}
                    cx={x(current)}
                    cy={y(count(data.periods[current], key))}
                    r="3"
                    fill={seriesStyle(key, options).color}
                  />
                ))}
              </>
            )}
          </svg>
          {selected !== null && (
            <div
              className={styles.chartTooltip}
              role="status"
              style={{
                left: `clamp(0px, ${(x(current) / width) * 100}% - 120px, calc(100% - 260px))`,
              }}
            >
              <strong>{data.periods[current]}</strong>
              {visible.map((key) => (
                <span key={JSON.stringify(key)}>
                  {deviceLabel(key, data.groupBy)}：
                  {count(data.periods[current], key).toLocaleString()}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className={styles.empty}>{t('没有可用于时间曲线的拍摄日期')}</p>
      )}
      <p id={description} className={styles.chartHint}>
        {t('悬停查看数量，方向键切换时间，点击图例显示或隐藏曲线。')}
      </p>
      {keys.includes(null) && (
        <p className={styles.hint}>
          {t('曲线最多显示 23 个设备，其余合并为其他；使用量柱状图保留全部设备。')}
        </p>
      )}
    </>
  );
}

export function PhotoUsageChart({
  items,
  kind,
  selected,
  onSelect,
}: {
  items: PhotoUsage[];
  kind: 'camera' | 'lens';
  selected: string[];
  onSelect: (key: string) => void;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <div
      role="group"
      aria-label={kind === 'camera' ? t('相机使用量柱状图') : t('镜头使用量柱状图')}
      className={styles.ranking}
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          className={styles.rankRow}
          aria-label={`${kind === 'camera' ? t('相机') : t('镜头')}：${deviceLabel(item.key, kind)}`}
          aria-pressed={selected.includes(item.key)}
          onClick={() => onSelect(item.key)}
        >
          <span className={styles.rankIndex}>{String(index + 1).padStart(2, '0')}</span>
          <span className={styles.rankDevice}>
            <span>{deviceLabel(item.key, kind)}</span>
            <span className={styles.rankTrack}>
              <span style={{ width: `${total ? (item.count / total) * 100 : 0}%` }} />
            </span>
          </span>
          <strong>{item.count.toLocaleString()}</strong>
          <span className={styles.rankShare}>
            {(total ? (item.count / total) * 100 : 0).toFixed(1)}%
          </span>
        </button>
      ))}
    </div>
  );
}
