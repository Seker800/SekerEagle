import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconChevronDown, IconRefresh, IconX } from '@tabler/icons-react';
import { t } from '../../i18n';
import { getPhotoStatistics, type PhotoStatisticsQuery } from '../../lib/photo-statistics-api';
import { deviceLabel, PhotoTimeChart, PhotoUsageChart } from './PhotoStatisticsCharts';
import { statisticsDateRange, type StatisticsRange } from './photo-statistics-range';
import styles from './PhotoStatistics.module.css';

type Panel = 'camera' | 'lens' | 'date' | null;
const timeRanges = () =>
  [
    { value: 1, label: t('最近1年') },
    { value: 3, label: t('最近3年') },
    { value: 5, label: t('最近5年') },
    { value: 'all', label: t('所有时长') },
  ] as const;
export function PhotoStatistics({
  ownerId,
  includePrivate,
}: {
  ownerId: string | null;
  includePrivate: boolean;
}) {
  const [dates, setDates] = useState(() => statisticsDateRange(3));
  const [input, setInput] = useState<PhotoStatisticsQuery>(() => ({
    start: dates.start,
    end: dates.end,
    grain: 'month',
    groupBy: 'camera',
    cameras: [],
    lenses: [],
  }));
  const [preset, setPreset] = useState<StatisticsRange | 'custom'>(3);
  const [panel, setPanel] = useState<Panel>(null);
  const [search, setSearch] = useState('');
  const [rangeError, setRangeError] = useState(false);
  const result = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'statistics', includePrivate, input],
    queryFn: ({ signal }) => getPhotoStatistics(input, signal),
    staleTime: 30000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === ownerId && previousQuery.queryKey[4] === includePrivate
        ? previous
        : undefined,
  });
  const options = result;
  const data = result.data;
  const applyDates = useCallback(() => {
    if (dates.start && dates.end && dates.start > dates.end) {
      setRangeError(true);
      return false;
    }
    setRangeError(false);
    setPreset(dates.start || dates.end ? 'custom' : 'all');
    setInput((current) =>
      current.start === (dates.start || undefined) && current.end === (dates.end || undefined)
        ? current
        : { ...current, start: dates.start || undefined, end: dates.end || undefined },
    );
    return true;
  }, [dates]);
  useEffect(() => {
    if (panel !== 'date') return;
    const timer = window.setTimeout(applyDates, 350);
    return () => window.clearTimeout(timer);
  }, [applyDates, panel]);
  function openPanel(next: Exclude<Panel, null>) {
    setPanel((value) => (value === next ? null : next));
    setSearch('');
  }
  function timeRange(next: StatisticsRange) {
    const range = statisticsDateRange(next);
    setPreset(next);
    setDates(range);
    setPanel(null);
    setRangeError(false);
    setInput((value) => ({
      ...value,
      start: range.start || undefined,
      end: range.end || undefined,
    }));
  }
  function selectDevice(kind: 'camera' | 'lens', key: string) {
    const field = kind === 'camera' ? 'cameras' : 'lenses';
    setInput((value) => ({
      ...value,
      [field]: value[field].length === 1 && value[field][0] === key ? [] : [key],
    }));
  }
  const active = [
    ...input.cameras.map((key) => ({ kind: 'camera' as const, key })),
    ...input.lenses.map((key) => ({ kind: 'lens' as const, key })),
  ];
  const filterKind = panel === 'camera' || panel === 'lens' ? panel : null;
  const field = filterKind === 'camera' ? 'cameras' : 'lenses';
  const devices =
    (filterKind === 'camera' ? options.data?.cameraOptions : options.data?.lensOptions) ?? [];
  const filteredDevices = devices.filter((key) =>
    deviceLabel(key, filterKind ?? 'camera')
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <section
      className={styles.page}
      aria-label={t('照片统计')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setPanel(null);
      }}
    >
      <div className={styles.toolbar}>
        <div className={styles.segmented} aria-label={t('时间范围')} role="group">
          {timeRanges().map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={preset === value}
              onClick={() => timeRange(value)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label={t('自定义日期')}
            aria-expanded={panel === 'date'}
            aria-pressed={preset === 'custom'}
            onClick={() => openPanel('date')}
          >
            {preset === 'custom' ? `${input.start ?? '…'} — ${input.end ?? '…'}` : t('自定义日期')}
          </button>
        </div>
        <span className={styles.toolDivider} />
        {(['camera', 'lens'] as const).map((kind) => (
          <button
            key={kind}
            className={styles.filterButton}
            type="button"
            aria-label={kind === 'camera' ? t('相机筛选') : t('镜头筛选')}
            aria-expanded={panel === kind}
            onClick={() => openPanel(kind)}
          >
            {kind === 'camera' ? t('相机') : t('镜头')}
            <span>{input[kind === 'camera' ? 'cameras' : 'lenses'].length || t('全部')}</span>
            <IconChevronDown size={12} aria-hidden />
          </button>
        ))}
        <button
          type="button"
          className={styles.refresh}
          aria-label={t('刷新统计')}
          title={t('刷新统计')}
          onClick={() => {
            void result.refetch();
          }}
        >
          <IconRefresh size={14} aria-hidden />
        </button>
      </div>
      {panel === 'date' && (
        <form
          className={styles.dateRange}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) applyDates();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (applyDates()) setPanel(null);
          }}
        >
          <label>
            {t('开始日期')}
            <input
              aria-label={t('开始日期')}
              type="date"
              value={dates.start}
              onChange={(event) => setDates((value) => ({ ...value, start: event.target.value }))}
            />
          </label>
          <label>
            {t('结束日期')}
            <input
              aria-label={t('结束日期')}
              type="date"
              value={dates.end}
              onChange={(event) => setDates((value) => ({ ...value, end: event.target.value }))}
            />
          </label>
          <button type="submit">{t('应用日期')}</button>
          {rangeError && <span role="alert">{t('开始日期不能晚于结束日期。')}</span>}
        </form>
      )}
      {filterKind && (
        <div className={styles.filterPanel}>
          <div className={styles.filterSearch}>
            <input
              type="search"
              aria-label={t('搜索设备')}
              placeholder={t('搜索设备')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span>
              {filteredDevices.length} / {devices.length}
            </span>
            <button type="button" onClick={() => setInput((value) => ({ ...value, [field]: [] }))}>
              {t('清除选择')}
            </button>
          </div>
          <div className={styles.deviceOptions}>
            {filteredDevices.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={input[field].includes(key)}
                  disabled={input[field].length >= 50 && !input[field].includes(key)}
                  onChange={(event) =>
                    setInput((value) => ({
                      ...value,
                      [field]: event.target.checked
                        ? [...value[field], key]
                        : value[field].filter((item) => item !== key),
                    }))
                  }
                />
                {deviceLabel(key, filterKind)}
              </label>
            ))}
          </div>
          {options.isError && <p role="alert">{options.error.message}</p>}
          {!filteredDevices.length && !options.isPending && (
            <p className={styles.hint}>{t('没有匹配的设备')}</p>
          )}
        </div>
      )}
      {!!active.length && (
        <div className={styles.activeFilters}>
          {active.map(({ kind, key }) => (
            <button
              type="button"
              key={`${kind}:${key}`}
              aria-label={t('移除筛选：{{value1}}', { value1: deviceLabel(key, kind) })}
              onClick={() => {
                const field = kind === 'camera' ? 'cameras' : 'lenses';
                setInput((value) => ({
                  ...value,
                  [field]: value[field].filter((item) => item !== key),
                }));
              }}
            >
              {deviceLabel(key, kind)}
              <IconX size={12} aria-hidden />
            </button>
          ))}
          <button
            type="button"
            className={styles.reset}
            onClick={() => setInput((value) => ({ ...value, cameras: [], lenses: [] }))}
          >
            {t('重置筛选')}
          </button>
        </div>
      )}
      {result.isPending && <p role="status">{t('正在加载统计…')}</p>}
      {result.isPlaceholderData && (
        <span className={styles.updating} role="status">
          {t('正在更新统计…')}
        </span>
      )}
      {result.isError && (
        <div role="alert" className={styles.error}>
          <p>{result.error.message}</p>
          <button type="button" onClick={() => void result.refetch()}>
            {t('重试')}
          </button>
        </div>
      )}
      {data && !result.isError && (
        <div
          className={result.isPlaceholderData ? styles.updatingCharts : undefined}
          aria-busy={result.isPlaceholderData}
        >
          <div className={styles.summary}>
            <div className={styles.total}>
              <strong>{data.total.toLocaleString()}</strong>
              <span>{t('照片数量')}</span>
            </div>
            <div>
              <strong>{data.cameras.length}</strong>
              <span>{t('相机型号')}</span>
            </div>
            <div>
              <strong>{data.lenses.length}</strong>
              <span>{t('镜头型号')}</span>
            </div>
            <div className={styles.unknown}>
              <strong>{data.unknownDate.toLocaleString()}</strong>
              <span>{t('拍摄日期未知')}</span>
            </div>
          </div>
          <section className={styles.trend}>
            <header className={styles.chartHeader}>
              <h2>{t('拍摄量')}</h2>
              <div className={styles.segmented} role="group" aria-label={t('曲线分组')}>
                {(['total', 'camera', 'lens'] as const).map((groupBy) => (
                  <button
                    key={groupBy}
                    type="button"
                    aria-pressed={input.groupBy === groupBy}
                    onClick={() => setInput((value) => ({ ...value, groupBy }))}
                  >
                    {groupBy === 'total'
                      ? t('总量')
                      : groupBy === 'camera'
                        ? t('按相机')
                        : t('按镜头')}
                  </button>
                ))}
              </div>
              <div className={styles.segmented} role="group" aria-label={t('时间粒度')}>
                {(['year', 'month', 'week'] as const).map((grain) => (
                  <button
                    key={grain}
                    type="button"
                    aria-pressed={input.grain === grain}
                    onClick={() => setInput((value) => ({ ...value, grain }))}
                  >
                    {grain === 'year' ? t('年') : grain === 'month' ? t('月') : t('周')}
                  </button>
                ))}
              </div>
            </header>
            {!data.total ? (
              <p className={styles.empty}>{t('当前条件下没有照片')}</p>
            ) : (
              <PhotoTimeChart key={JSON.stringify(input)} data={data} />
            )}
          </section>
          {!!data.total && (
            <div className={styles.usageGrid}>
              {(['camera', 'lens'] as const).map((kind) => (
                <section key={kind} className={styles.usageCard}>
                  <header className={styles.chartHeader}>
                    <h2>{kind === 'camera' ? t('相机使用量') : t('镜头使用量')}</h2>
                    <span>{t('数量 / 占比')}</span>
                  </header>
                  <PhotoUsageChart
                    kind={kind}
                    items={kind === 'camera' ? data.cameras : data.lenses}
                    selected={input[kind === 'camera' ? 'cameras' : 'lenses']}
                    onSelect={(key) => selectDevice(kind, key)}
                  />
                </section>
              ))}
            </div>
          )}
          <p className={styles.hint}>
            {t(
              '点击设备可直接筛选，再次点击取消。仅统计可见照片，不含视频和回收站；未知日期不使用导入时间替代。',
            )}
          </p>
        </div>
      )}
    </section>
  );
}
