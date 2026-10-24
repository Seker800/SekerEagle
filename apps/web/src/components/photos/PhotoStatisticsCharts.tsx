import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { t } from '../../i18n';
import type { PhotoStatisticsData } from '../../lib/photo-statistics-api';
import type { PhotoUsage } from '../../lib/photo-statistics-api';
import { smoothStatisticsPath } from './photo-statistics-curve';
import styles from './PhotoStatistics.module.css';

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
export const deviceLabel = (key: string | null, kind: 'total' | 'camera' | 'lens') =>
  kind === 'total'
    ? t('总拍摄量')
    : key === null
      ? t('其他设备（合并）')
      : key || (kind === 'camera' ? t('未知相机') : t('未知镜头'));

export function PhotoTimeChart({ data }: { data: PhotoStatisticsData }) {
  const [selected, setSelected] = useState<{
    index: number;
    key: string | null;
    pointer?: { x: number; y: number };
  } | null>(null);
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
  const keys = useMemo(() => [...new Set(data.points.map((point) => point.key))], [data.points]);
  const values = useMemo(
    () =>
      new Map(data.points.map((point) => [JSON.stringify([point.period, point.key]), point.count])),
    [data.points],
  );
  const count = useCallback(
    (period: string, key: string | null) => values.get(JSON.stringify([period, key])) ?? 0,
    [values],
  );
  const options =
    data.groupBy === 'total'
      ? ['']
      : data.groupBy === 'camera'
        ? data.cameraOptions
        : data.lensOptions;
  const visible = useMemo(() => keys.filter((key) => !hidden.has(key)), [keys, hidden]);
  const ceiling = useMemo(
    () =>
      Math.max(
        4,
        Math.ceil(
          data.points.reduce(
            (maximum, point) => (hidden.has(point.key) ? maximum : Math.max(maximum, point.count)),
            1,
          ) / 4,
        ) * 4,
      ),
    [data.points, hidden],
  );
  const height = 216,
    left = 32,
    right = 12,
    top = 12,
    bottom = 30;
  const x = useCallback(
    (index: number) =>
      left +
      (data.periods.length > 1 ? index / (data.periods.length - 1) : 0.5) * (width - left - right),
    [data.periods.length, width],
  );
  const y = useCallback(
    (value: number) => height - bottom - (value / ceiling) * (height - top - bottom),
    [ceiling],
  );
  // Geometry stays cached while the pointer moves; only the active marker and tooltip change.
  const paths = useMemo(
    () =>
      new Map(
        visible.map((key) => [
          key,
          smoothStatisticsPath(
            data.periods.map((period, index) => [x(index), y(count(period, key))]),
          ),
        ]),
      ),
    [visible, data.periods, x, y, count],
  );
  const current = Math.min(
    selected?.index ?? data.periods.length - 1,
    Math.max(0, data.periods.length - 1),
  );
  const activeKey = highlight !== undefined ? highlight : selected?.key;
  const tickCount = Math.min(width < 500 ? 4 : 7, data.periods.length);
  const ticks = new Set(
    Array.from({ length: tickCount }, (_, i) =>
      Math.round((i * (data.periods.length - 1)) / Math.max(1, tickCount - 1)),
    ),
  );
  function inspectCurve(
    event: PointerEvent<SVGPathElement | SVGCircleElement>,
    key: string | null,
  ) {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    const bounds = frame.current?.getBoundingClientRect();
    if (rect?.width)
      setSelected({
        key,
        pointer: bounds
          ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
          : undefined,
        index: Math.max(
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
      });
  }
  const anchor = selected?.pointer ?? {
    x: x(current),
    y: y(count(data.periods[current], selected ? selected.key : '')),
  };
  // Follow the pointer in CSS pixels, flipping within the chart near its edges.
  const tooltipLeft = Math.max(
    4,
    Math.min(width - 164, anchor.x + (anchor.x > width - 176 ? -172 : 12)),
  );
  const tooltipTop = Math.max(
    4,
    Math.min(height - 48, anchor.y + (anchor.y > height - 60 ? -56 : 12)),
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
            aria-label={t('拍摄量曲线图')}
            aria-describedby={description}
            onFocus={() => {
              const key = visible[0];
              if (key !== undefined)
                setSelected((value) => value ?? { key, index: data.periods.length - 1 });
            }}
            onBlur={() => setSelected(null)}
            onPointerLeave={() => setSelected(null)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const key = selected ? selected.key : visible[0];
              if (key !== undefined)
                setSelected({
                  key,
                  index:
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
                });
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
                  opacity={activeKey === undefined || activeKey === key ? 1 : 0.18}
                >
                  <path
                    data-statistics-curve={key ?? '__other__'}
                    d={paths.get(key)}
                    fill="none"
                    stroke={style.color}
                    strokeDasharray={style.dash}
                    strokeWidth={activeKey === key ? 2.4 : 1.6}
                  />
                  {data.periods.length === 1 ? (
                    <>
                      <circle
                        cx={x(0)}
                        cy={y(count(data.periods[0], key))}
                        r="3"
                        fill={style.color}
                      />
                      <circle
                        data-curve-hit={key ?? '__other__'}
                        cx={x(0)}
                        cy={y(count(data.periods[0], key))}
                        r="8"
                        fill="transparent"
                        onPointerMove={(event) => inspectCurve(event, key)}
                        onPointerLeave={() => setSelected(null)}
                      />
                    </>
                  ) : (
                    <path
                      data-curve-hit={key ?? '__other__'}
                      d={paths.get(key)}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="10"
                      style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
                      onPointerMove={(event) => inspectCurve(event, key)}
                      onPointerLeave={() => setSelected(null)}
                    />
                  )}
                </g>
              );
            })}
            {selected !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(current)}
                  x2={x(current)}
                  y1={top}
                  y2={height - bottom}
                  className={styles.cursor}
                />
                <circle
                  cx={x(current)}
                  cy={y(count(data.periods[current], selected.key))}
                  r="3"
                  fill={seriesStyle(selected.key, options).color}
                />
              </g>
            )}
          </svg>
          {selected !== null && (
            <div
              className={styles.chartTooltip}
              role="status"
              style={{
                left: tooltipLeft,
                top: tooltipTop,
              }}
            >
              <span>{deviceLabel(selected.key, data.groupBy)}</span>
              <div>
                <time>{data.periods[current]}</time>
                <strong>{count(data.periods[current], selected.key).toLocaleString()}</strong>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className={styles.empty}>{t('没有可用于时间曲线的拍摄日期')}</p>
      )}
      <p id={description} className={styles.chartHint}>
        {t('悬停曲线查看该设备数量，方向键切换时间。')}
        {data.grain === 'week' && ` ${t('每周从周一开始。')}`}
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
