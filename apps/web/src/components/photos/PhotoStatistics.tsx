import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { t } from '../../i18n';
import { getPhotoStatistics, type PhotoStatisticsQuery } from '../../lib/photo-statistics-api';
import { deviceLabel, PhotoTimeChart, PhotoUsageChart } from './PhotoStatisticsCharts';
import styles from './PhotoStatistics.module.css';

function EquipmentFilter({
  kind,
  options,
  selected,
  onChange,
}: {
  kind: 'camera' | 'lens';
  options: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <details className={styles.equipment}>
      <summary>
        {kind === 'camera' ? t('相机') : t('镜头')}
        <span>{selected.length ? selected.length : t('全部')}</span>
      </summary>
      <div className={styles.options}>
        <button type="button" onClick={() => onChange([])}>
          {t('清除选择')}
        </button>
        {options.map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={selected.includes(key)}
              disabled={selected.length >= 50 && !selected.includes(key)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, key]
                    : selected.filter((item) => item !== key),
                )
              }
            />
            {deviceLabel(key, kind)}
          </label>
        ))}
      </div>
    </details>
  );
}
export function PhotoStatistics({
  ownerId,
  includePrivate,
}: {
  ownerId: string | null;
  includePrivate: boolean;
}) {
  const [input, setInput] = useState<PhotoStatisticsQuery>({
    grain: 'month',
    groupBy: 'camera',
    cameras: [],
    lenses: [],
  });
  const [dates, setDates] = useState({ start: '', end: '' });
  const [rangeError, setRangeError] = useState(false);
  const result = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'statistics', includePrivate, input],
    queryFn: ({ signal }) => getPhotoStatistics(input, signal),
    staleTime: 30000,
  });
  // Options have their own unfiltered cache so changing a filter cannot remove its choices.
  const options = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'statistics', includePrivate, 'options'],
    queryFn: ({ signal }) =>
      getPhotoStatistics({ grain: 'year', groupBy: 'camera', cameras: [], lenses: [] }, signal),
    staleTime: 30000,
  });
  const data = result.data;
  return (
    <section className={styles.page} aria-label={t('照片统计')}>
      <div className={styles.intro}>
        <p>{t('按拍摄时间查看相机和镜头的使用变化')}</p>
        <button
          type="button"
          onClick={() => {
            void result.refetch();
            void options.refetch();
          }}
        >
          {t('刷新统计')}
        </button>
      </div>
      <div className={styles.filters}>
        <form
          className={styles.dateRange}
          onSubmit={(event) => {
            event.preventDefault();
            if (dates.start && dates.end && dates.start > dates.end) {
              setRangeError(true);
              return;
            }
            setRangeError(false);
            setInput((value) => ({
              ...value,
              start: dates.start || undefined,
              end: dates.end || undefined,
            }));
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
          <span>—</span>
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
          <button
            type="button"
            onClick={() => {
              setDates({ start: '', end: '' });
              setRangeError(false);
              setInput((value) => ({ ...value, start: undefined, end: undefined }));
            }}
          >
            {t('全部时间')}
          </button>
        </form>
        <EquipmentFilter
          kind="camera"
          options={options.data?.cameraOptions ?? []}
          selected={input.cameras}
          onChange={(cameras) => setInput((value) => ({ ...value, cameras }))}
        />
        <EquipmentFilter
          kind="lens"
          options={options.data?.lensOptions ?? []}
          selected={input.lenses}
          onChange={(lenses) => setInput((value) => ({ ...value, lenses }))}
        />
      </div>
      {rangeError && <p role="alert">{t('开始日期不能晚于结束日期。')}</p>}
      <div className={styles.chartControls}>
        <label>
          {t('曲线分组')}
          <select
            aria-label={t('曲线分组')}
            value={input.groupBy}
            onChange={(event) =>
              setInput((value) => ({
                ...value,
                groupBy: event.target.value as PhotoStatisticsQuery['groupBy'],
              }))
            }
          >
            <option value="camera">{t('按相机')}</option>
            <option value="lens">{t('按镜头')}</option>
          </select>
        </label>
        <label>
          {t('时间粒度')}
          <select
            aria-label={t('时间粒度')}
            value={input.grain}
            onChange={(event) =>
              setInput((value) => ({
                ...value,
                grain: event.target.value as PhotoStatisticsQuery['grain'],
              }))
            }
          >
            <option value="year">{t('年')}</option>
            <option value="month">{t('月')}</option>
            <option value="day">{t('日')}</option>
          </select>
        </label>
      </div>
      {result.isPending && <p role="status">{t('正在加载统计…')}</p>}
      {result.isError && (
        <div role="alert" className={styles.error}>
          <p>{result.error.message}</p>
          <button type="button" onClick={() => void result.refetch()}>
            {t('重试')}
          </button>
        </div>
      )}
      {data && !result.isError && (
        <>
          <div className={styles.summary}>
            <div>
              <span>{t('照片数量')}</span>
              <strong>{data.total.toLocaleString()}</strong>
            </div>
            <div>
              <span>{t('相机型号')}</span>
              <strong>{data.cameras.length}</strong>
            </div>
            <div>
              <span>{t('镜头型号')}</span>
              <strong>{data.lenses.length}</strong>
            </div>
            <div>
              <span>{t('拍摄日期未知')}</span>
              <strong>{data.unknownDate.toLocaleString()}</strong>
            </div>
          </div>
          {!data.total ? (
            <p className={styles.empty}>{t('当前条件下没有照片')}</p>
          ) : (
            <>
              <section className={styles.card}>
                <header>
                  <h2>{t('拍摄量')}</h2>
                  <span>{t('照片数量')}</span>
                </header>
                <PhotoTimeChart key={JSON.stringify(input)} data={data} />
              </section>
              <div className={styles.usageGrid}>
                <section className={styles.card}>
                  <header>
                    <h2>{t('相机使用量')}</h2>
                    <span>{t('按照片数量排序')}</span>
                  </header>
                  <PhotoUsageChart
                    kind="camera"
                    items={data.cameras}
                    options={data.cameraOptions}
                  />
                </section>
                <section className={styles.card}>
                  <header>
                    <h2>{t('镜头使用量')}</h2>
                    <span>{t('按照片数量排序')}</span>
                  </header>
                  <PhotoUsageChart kind="lens" items={data.lenses} options={data.lensOptions} />
                </section>
              </div>
            </>
          )}
          <p className={styles.hint}>
            {t(
              '仅统计当前可见的照片，视频和回收站不参与。按相机记录的本地拍摄日期统计，缺失日期不使用导入时间替代。',
            )}
          </p>
        </>
      )}
    </section>
  );
}
