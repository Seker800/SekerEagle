import { useState } from 'react';
import { t } from '../../i18n';
import type { PhotoStatisticsData, PhotoUsage } from '../../lib/photo-statistics-api';
import styles from './PhotoStatistics.module.css';

const colors = [
  '#7897ef',
  '#65bdab',
  '#dba363',
  '#b68ae0',
  '#e0819b',
  '#80adcb',
  '#a6b76b',
  '#cf8a67',
];
const colorFor = (key: string | null, options: string[]) => {
  if (key === null) return '#9299a8';
  const index = Math.max(0, options.indexOf(key));
  return colors[index] ?? `hsl(${((index - colors.length) * 137.508) % 360} 60% 65%)`;
};
export const deviceLabel = (key: string | null, kind: 'camera' | 'lens') =>
  key === null ? t('其他设备（合并）') : key || (kind === 'camera' ? t('未知相机') : t('未知镜头'));

export function PhotoTimeChart({ data }: { data: PhotoStatisticsData }) {
  const [selected, setSelected] = useState(0);
  const [hidden, setHidden] = useState<Set<string | null>>(new Set());
  const keys = [...new Set(data.points.map((point) => point.key))];
  const values = new Map(
    data.points.map((point) => [JSON.stringify([point.period, point.key]), point.count]),
  );
  const count = (period: string, key: string | null) =>
    values.get(JSON.stringify([period, key])) ?? 0;
  const options = data.groupBy === 'camera' ? data.cameraOptions : data.lensOptions;
  const ticks = new Set(Array.from({ length: Math.min(7, data.periods.length) }, (_, i) => Math.round(i * (data.periods.length - 1) / Math.max(1, Math.min(7, data.periods.length) - 1))));
  const visible = keys.filter((key) => !hidden.has(key));
  const max = Math.max(
    1,
    ...data.points.filter((point) => !hidden.has(point.key)).map((point) => point.count),
  );
  const ceiling = Math.max(4, Math.ceil(max / 4) * 4);
  const width = 1000,
    height = 300,
    left = 58,
    right = 18,
    top = 20,
    bottom = 46;
  const x = (index: number) =>
    left +
    (data.periods.length > 1 ? index / (data.periods.length - 1) : 0.5) * (width - left - right);
  const y = (value: number) => height - bottom - (value / ceiling) * (height - top - bottom);
  const current = Math.min(selected, Math.max(0, data.periods.length - 1));
  return (
    <>
      <div className={styles.legend}>
        {keys.map((key) => (
          <button
            key={JSON.stringify(key)}
            type="button"
            aria-pressed={!hidden.has(key)}
            onClick={() =>
              setHidden((previous) => {
                const next = new Set(previous);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          >
            <i style={{ background: colorFor(key, options), opacity: hidden.has(key) ? 0.25 : 1 }} />
            {deviceLabel(key, data.groupBy)}
          </button>
        ))}
      </div>
      {data.periods.length ? (
        <>
          <svg
            className={styles.timeChart}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={t('拍摄量折线图')}
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
                  y={height - 18}
                  textAnchor={i === 0 ? 'start' : i === data.periods.length - 1 ? 'end' : 'middle'}
                >
                  {period}
                </text>
              ) : null,
            )}
            {visible.map((key) => (
              <g key={JSON.stringify(key)}>
                <polyline
                  fill="none"
                  stroke={colorFor(key, options)}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  points={data.periods
                    .map((period, i) => `${x(i)},${y(count(period, key))}`)
                    .join(' ')}
                />
                {data.periods.length === 1 && (
                  <circle
                    cx={x(0)}
                    cy={y(count(data.periods[0], key))}
                    r="4"
                    fill={colorFor(key, options)}
                  />
                )}
              </g>
            ))}
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
                r="4"
                fill={colorFor(key, options)}
              />
            ))}
          </svg>
          <input
            className={styles.scrubber}
            type="range"
            min="0"
            max={Math.max(0, data.periods.length - 1)}
            value={current}
            aria-label={t('查看时间段')}
            onChange={(event) => setSelected(Number(event.target.value))}
          />
          <div className={styles.readout} aria-live="polite">
            <strong>{data.periods[current]}</strong>
            {visible.map((key) => (
              <span key={JSON.stringify(key)} style={{ color: colorFor(key, options) }}>
                {deviceLabel(key, data.groupBy)}：
                {count(data.periods[current], key).toLocaleString()}
              </span>
            ))}
          </div>
          {keys.includes(null) && (
            <p className={styles.hint}>
              {t('曲线最多显示 23 个设备，其余合并为其他；使用量柱状图保留全部设备。')}
            </p>
          )}
        </>
      ) : (
        <p className={styles.empty}>{t('没有可用于时间曲线的拍摄日期')}</p>
      )}
    </>
  );
}

export function PhotoUsageChart({ items, kind, options }: { items: PhotoUsage[]; kind: 'camera' | 'lens'; options: string[] }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div
      className={styles.barScroll}
      role="img"
      aria-label={kind === 'camera' ? t('相机使用量柱状图') : t('镜头使用量柱状图')}
    >
      <div className={styles.bars} style={{ minWidth: `${Math.max(items.length * 105, 300)}px` }}>
        {items.map((item) => (
          <div
            className={styles.barColumn}
            key={item.key}
            title={`${deviceLabel(item.key, kind)}：${item.count.toLocaleString()}`}
          >
            <span className={styles.barValue}>{item.count.toLocaleString()}</span>
            <div className={styles.barTrack}>
              <div
                className={styles.bar}
                style={{ height: `${(item.count / max) * 100}%`, background: colorFor(item.key, options) }}
              />
            </div>
            <span className={styles.barLabel}>{deviceLabel(item.key, kind)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
