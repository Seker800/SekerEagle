import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PhotoStatisticsData } from '../../lib/photo-statistics-api';
import { PhotoStatistics } from './PhotoStatistics';
import { PhotoUsageChart, PhotoTimeChart } from './PhotoStatisticsCharts';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/photo-statistics-api', () => ({ getPhotoStatistics: get }));
const data: PhotoStatisticsData = {
  total: 6,
  unknownDate: 1,
  grain: 'month',
  groupBy: 'camera',
  periods: ['2024-01', '2024-02', '2024-03'],
  cameraOptions: ['Camera A', 'Camera B', ''],
  lensOptions: ['Lens A'],
  cameras: [{ key: 'Camera A', count: 6 }],
  lenses: [{ key: 'Lens A', count: 6 }],
  points: [{ period: '2024-01', key: 'Camera A', count: 5 }],
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PhotoStatistics ownerId="owner" includePrivate={false} />
    </QueryClientProvider>,
  );
}
beforeEach(() => get.mockReset());
describe('photo statistics', () => {
  it('shows three charts, calendar gaps, totals and unknown dates', async () => {
    get.mockResolvedValue(data);
    mount();
    expect(await screen.findByRole('img', { name: '拍摄量折线图' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '相机使用量柱状图' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '镜头使用量柱状图' })).toBeInTheDocument();
    expect(screen.getByText('拍摄日期未知')).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: '拍摄量折线图' });
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'Home' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText('2024-02', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Camera A：0')).toBeInTheDocument();
  });
  it('combines camera and lens filters and switches the time series dimension', async () => {
    get.mockResolvedValue(data);
    mount();
    await screen.findByRole('img', { name: '拍摄量折线图' });
    fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Camera A', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '镜头筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lens A', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '按镜头' }));
    await waitFor(() =>
      expect(get.mock.calls.at(-1)?.[0]).toMatchObject({
        cameras: ['Camera A'],
        lenses: ['Lens A'],
        groupBy: 'lens',
      }),
    );
  });
  it('offers retry without presenting stale charts after a failed query', async () => {
    get.mockRejectedValue(new Error('Offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    get.mockResolvedValue({ ...data, total: 0, periods: [], points: [], cameras: [], lenses: [] });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('当前条件下没有照片')).toBeInTheDocument();
  });
});

describe('statistics interactions', () => {
  it('applies inclusive dates, rejects inverted dates and resets the range', async () => {
    get.mockResolvedValue(data);
    mount();
    await screen.findByRole('img', { name: '拍摄量折线图' });
    fireEvent.click(screen.getByRole('button', { name: '自定义日期' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2024-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    expect(screen.getByRole('alert')).toHaveTextContent('开始日期不能晚于结束日期。');
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2025-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    await waitFor(() =>
      expect(get.mock.calls.at(-1)?.[0]).toMatchObject({ start: '2025-01-01', end: '2025-12-31' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '年', exact: true }));
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0].grain).toBe('year'));
    fireEvent.click(screen.getByRole('button', { name: '全部时间' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义日期' }));
    await waitFor(() => expect(screen.getByLabelText('开始日期')).toHaveValue(''));
    fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  });
  it('supports deselection and clearing equipment choices', async () => {
    get.mockResolvedValue(data);
    mount();
    await screen.findByRole('img', { name: '拍摄量折线图' });
    fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Camera A', exact: true }));
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0].cameras).toEqual(['Camera A']));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Camera A', exact: true }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Camera A', exact: true })).not.toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: '镜头筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lens A', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
    expect(screen.getByRole('checkbox', { name: 'Lens A', exact: true })).not.toBeChecked();
  });
  it('keeps unrecognised devices and missing dates explicit', async () => {
    get.mockResolvedValue({
      ...data,
      periods: [],
      points: [],
      cameras: [{ key: '', count: 6 }],
      lenses: [{ key: '', count: 6 }],
    });
    mount();
    expect(await screen.findByText('没有可用于时间曲线的拍摄日期')).toBeInTheDocument();
    expect(screen.getAllByText('未知相机').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未知镜头').length).toBeGreaterThan(0);
  });
  it('toggles series and labels the combined overflow without losing counts', () => {
    render(
      <PhotoTimeChart
        data={{
          ...data,
          periods: ['2024-01'],
          points: [
            { period: '2024-01', key: null, count: 3 },
            { period: '2024-01', key: '', count: 2 },
          ],
        }}
      />,
    );
    const other = screen.getByRole('button', { name: '其他设备（合并）' });
    fireEvent.click(other);
    expect(other).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(other);
    expect(other).toHaveAttribute('aria-pressed', 'true');
    fireEvent.focus(screen.getByRole('img', { name: '拍摄量折线图' }));
    expect(screen.getByText('其他设备（合并）：3')).toBeInTheDocument();
    expect(screen.getByText('未知相机：2')).toBeInTheDocument();
  });
});

it('gives each visible device a distinct color and keeps long-range axis labels readable', () => {
  const devices = Array.from({ length: 10 }, (_, i) => `Camera ${i}`);
  const periods = Array.from(
    { length: 121 },
    (_, i) => `${2016 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
  );
  const view = render(
    <PhotoTimeChart
      data={{
        ...data,
        cameraOptions: devices,
        periods,
        points: devices.map((key) => ({ key, period: periods[0], count: 1 })),
      }}
    />,
  );
  const swatches = view.container.querySelectorAll('button i');
  expect(new Set(Array.from(swatches, (element) => element.getAttribute('style'))).size).toBe(10);
  const labels = Array.from(view.container.querySelectorAll('svg text')).filter((element) =>
    element.textContent?.includes('-'),
  );
  expect(labels.length).toBeLessThanOrEqual(7);
});

it('shows full equipment names, shares and a direct filter action without a horizontal scroller', () => {
  const label = 'GF100-200mmF5.6 R LM OIS WR Long Equipment Name';
  const select = vi.fn();
  const view = render(<PhotoUsageChart kind="lens" items={[{ key: label, count: 3 }, { key: 'Other', count: 1 }]} selected={[]} onSelect={select} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByText('75.0%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: `镜头：${label}` }));
  expect(select).toHaveBeenCalledWith(label);
  expect(view.container.querySelector('[style*="min-width"]')).toBeNull();
});

it('searches full device lists, exposes active filters and clears them together', async () => {
  get.mockResolvedValue(data); mount(); await screen.findByRole('img', { name: '拍摄量折线图' });
  fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
  fireEvent.change(screen.getByLabelText('搜索设备'), { target: { value: 'Camera B' } });
  expect(screen.queryByRole('checkbox', { name: 'Camera A', exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Camera B', exact: true }));
  expect(screen.getByRole('button', { name: '移除筛选：Camera B' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '移除筛选：Camera A' })).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '移除筛选：Camera B' })).not.toBeInTheDocument();
});

it('filters from a ranked device row and supports a recent-year shortcut', async () => {
  get.mockResolvedValue(data); mount(); await screen.findByRole('img', { name: '拍摄量折线图' });
  fireEvent.click(screen.getByRole('button', { name: '相机：Camera A' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0].cameras).toEqual(['Camera A']));
  fireEvent.click(screen.getByRole('button', { name: '相机：Camera A' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '移除筛选：Camera A' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '最近一年' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0].end).toMatch(/^\d{4}-\d{2}-\d{2}$/));
});
