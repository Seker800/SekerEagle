import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PhotoStatisticsData } from '../../lib/photo-statistics-api';
import { PhotoStatistics } from './PhotoStatistics';
import { statisticsDateRange } from './photo-statistics-range';
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
beforeEach(() => {
  get.mockReset();
});
describe('photo statistics', () => {
  it('uses the existing aggregate response for global device options and refreshes only once', async () => {
    get.mockResolvedValue(data);
    mount();
    await screen.findByRole('img', { name: '拍摄量曲线图' });
    expect(get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
    expect(screen.getByRole('checkbox', { name: 'Camera B' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
  it('shows three charts, calendar gaps, totals and unknown dates', async () => {
    get.mockResolvedValue(data);
    mount();
    expect(await screen.findByRole('img', { name: '拍摄量曲线图' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '相机使用量柱状图' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '镜头使用量柱状图' })).toBeInTheDocument();
    expect(screen.getByText('拍摄日期未知')).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: '拍摄量曲线图' });
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'Home' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText('2024-02', { selector: 'time' })).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText('0')).toBeInTheDocument();
  });
  it('applies valid custom dates automatically without requiring the apply button', async () => {
    get.mockResolvedValue(data);
    const view = mount();
    await screen.findByRole('img', { name: '拍摄量曲线图' });
    fireEvent.click(screen.getByRole('button', { name: '自定义日期' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2025-12-31' } });
    await waitFor(() =>
      expect(get.mock.calls.at(-1)?.[0]).toMatchObject({ start: '2025-01-01', end: '2025-12-31' }),
    );
    view.unmount();
  });
  it('combines camera and lens filters and switches the time series dimension', async () => {
    get.mockResolvedValue(data);
    mount();
    await screen.findByRole('img', { name: '拍摄量曲线图' });
    fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Camera A' }));
    fireEvent.click(screen.getByRole('button', { name: '镜头筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lens A' }));
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
    await screen.findByRole('img', { name: '拍摄量曲线图' });
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
    fireEvent.click(screen.getByRole('button', { name: '年' }));
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0].grain).toBe('year'));
    fireEvent.click(screen.getByRole('button', { name: '所有时长' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义日期' }));
    await waitFor(() => expect(screen.getByLabelText('开始日期')).toHaveValue(''));
    fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  });
  it('supports deselection and clearing equipment choices', async () => {
    get.mockResolvedValue(data);
    mount();
    await screen.findByRole('img', { name: '拍摄量曲线图' });
    fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Camera A' }));
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0].cameras).toEqual(['Camera A']));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Camera A' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Camera A' })).not.toBeChecked(),
    );
    fireEvent.click(screen.getByRole('button', { name: '镜头筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lens A' }));
    fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
    expect(screen.getByRole('checkbox', { name: 'Lens A' })).not.toBeChecked();
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
    fireEvent.focus(screen.getByRole('img', { name: '拍摄量曲线图' }));
    expect(screen.getByRole('status')).toHaveTextContent('其他设备（合并）');
    expect(within(screen.getByRole('status')).getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('未知相机');
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
  const view = render(
    <PhotoUsageChart
      kind="lens"
      items={[
        { key: label, count: 3 },
        { key: 'Other', count: 1 },
      ]}
      selected={[]}
      onSelect={select}
    />,
  );
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByText('75.0%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: `镜头：${label}` }));
  expect(select).toHaveBeenCalledWith(label);
  expect(view.container.querySelector('[style*="min-width"]')).toBeNull();
});

it('searches full device lists, exposes active filters and clears them together', async () => {
  get.mockResolvedValue(data);
  mount();
  await screen.findByRole('img', { name: '拍摄量曲线图' });
  fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
  fireEvent.change(screen.getByLabelText('搜索设备'), { target: { value: 'Camera B' } });
  expect(screen.queryByRole('checkbox', { name: 'Camera A' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Camera B' }));
  expect(screen.getByRole('button', { name: '移除筛选：Camera B' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '移除筛选：Camera A' })).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole('button', { name: '移除筛选：Camera B' })).not.toBeInTheDocument();
});

it('filters from a ranked device row and supports a recent-year shortcut', async () => {
  get.mockResolvedValue(data);
  mount();
  await screen.findByRole('img', { name: '拍摄量曲线图' });
  fireEvent.click(screen.getByRole('button', { name: '相机：Camera A' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0].cameras).toEqual(['Camera A']));
  fireEvent.click(screen.getByRole('button', { name: '相机：Camera A' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '移除筛选：Camera A' })).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: '最近1年' }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0].end).toMatch(/^\d{4}-\d{2}-\d{2}$/));
});

it('adapts the fixed-height chart to its container and supports pointer and keyboard inspection', () => {
  let resize: ResizeObserverCallback | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  vi.stubGlobal('PointerEvent', MouseEvent);
  const view = render(<PhotoTimeChart data={data} />);
  const chart = screen.getByRole('img', { name: '拍摄量曲线图' });
  act(() =>
    resize?.([{ contentRect: { width: 620 } } as ResizeObserverEntry], {} as ResizeObserver),
  );
  expect(chart.getAttribute('viewBox')).toBe('0 0 620 216');
  vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 620 } as DOMRect);
  fireEvent.pointerMove(view.container.querySelector('[data-curve-hit="Camera A"]')!, {
    clientX: 100,
  });
  expect(screen.getByRole('status')).toHaveTextContent('Camera A');
  expect(within(screen.getByRole('status')).getByText('5')).toBeInTheDocument();
  fireEvent.pointerLeave(chart);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.focus(chart);
  fireEvent.keyDown(chart, { key: 'End' });
  fireEvent.keyDown(chart, { key: 'ArrowLeft' });
  expect(screen.getByText('2024-02', { selector: 'time' })).toBeInTheDocument();
  fireEvent.keyDown(chart, { key: 'Tab' });
  fireEvent.blur(chart);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  const legend = screen.getByRole('button', { name: 'Camera A' });
  fireEvent.pointerEnter(legend);
  fireEvent.pointerLeave(legend);
  fireEvent.focus(legend);
  fireEvent.blur(legend);
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('does not keep another owner or privacy scope visible while a new query loads', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (ownerId: string, includePrivate: boolean) => (
    <QueryClientProvider client={client}>
      <PhotoStatistics ownerId={ownerId} includePrivate={includePrivate} />
    </QueryClientProvider>
  );
  get.mockResolvedValue(data);
  const view = render(content('owner', true));
  await screen.findByRole('img', { name: '拍摄量曲线图' });
  get.mockReturnValue(new Promise(() => {}));
  view.rerender(content('other', false));
  expect(screen.queryByRole('img', { name: '拍摄量曲线图' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('正在加载统计…');
});

it('defaults to the last three years with monthly camera curves, and offers year/month/week', async () => {
  get.mockResolvedValue(data);
  const view = mount();
  await screen.findByRole('img', { name: '拍摄量曲线图' });
  expect(get.mock.calls[0][0]).toMatchObject({
    ...statisticsDateRange(3),
    groupBy: 'camera',
    grain: 'month',
  });
  expect(screen.getByRole('button', { name: '最近3年' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '按相机' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['年', '月', '周'])
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '日' })).not.toBeInTheDocument();
  expect(view.container.querySelector('polyline')).toBeNull();
  expect(view.container.querySelector('path[data-statistics-curve]')?.getAttribute('d')).toContain(
    ' C ',
  );
});

it('offers rolling calendar-year ranges without changing equipment or monthly grain', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 24, 12));
  try {
    get.mockResolvedValue(data);
    mount();
    await screen.findByRole('img', { name: '拍摄量曲线图' });
    for (const years of [1, 3, 5]) {
      fireEvent.click(screen.getByRole('button', { name: `最近${years}年` }));
      expect(screen.getByRole('button', { name: `最近${years}年` })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await waitFor(() =>
        expect(
          get.mock.calls.some(
            ([query]) =>
              query.start === `${2026 - years}-10-24` &&
              query.end === '2026-10-24' &&
              query.grain === 'month' &&
              query.groupBy === 'camera',
          ),
        ).toBe(true),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: '所有时长' }));
    expect(screen.getByRole('button', { name: '所有时长' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '月' }));
    await waitFor(() =>
      expect(get.mock.calls.at(-1)?.[0]).toMatchObject({ start: undefined, end: undefined }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it('shows only the curve under the pointer and hides its compact tooltip when leaving', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const view = render(
    <PhotoTimeChart
      data={{
        ...data,
        points: [
          { period: '2024-01', key: 'Camera A', count: 5 },
          { period: '2024-01', key: 'Camera B', count: 2 },
        ],
      }}
    />,
  );
  const chart = screen.getByRole('img', { name: '拍摄量曲线图' });
  vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect);
  fireEvent.pointerMove(chart, { clientX: 32, clientY: 90 });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  const hit = view.container.querySelector('[data-curve-hit="Camera B"]');
  expect(hit).not.toBeNull();
  fireEvent.pointerMove(hit!, { clientX: 32, clientY: 90 });
  const tooltip = screen.getByRole('status');
  expect(tooltip).toHaveTextContent('Camera B');
  expect(tooltip).not.toHaveTextContent('Camera A');
  expect(tooltip).toHaveTextContent('2');
  fireEvent.pointerLeave(hit!);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});

it('moves the compact tooltip with the mouse even within the same time bucket, and avoids chart edges', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  try {
    const view = render(<PhotoTimeChart data={data} />);
    const chart = screen.getByRole('img', { name: '拍摄量曲线图' });
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 100,
      width: 1000,
      height: 216,
    } as DOMRect);
    vi.spyOn(chart.parentElement!, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 100,
      width: 1000,
      height: 216,
    } as DOMRect);
    const hit = view.container.querySelector('[data-curve-hit="Camera A"]')!;
    fireEvent.pointerMove(hit, { clientX: 120, clientY: 160 });
    expect(screen.getByRole('status')).toHaveStyle({ left: '112px', top: '72px' });
    fireEvent.pointerMove(hit, { clientX: 140, clientY: 180 });
    expect(screen.getByRole('status')).toHaveStyle({ left: '132px', top: '92px' });
    fireEvent.pointerMove(hit, { clientX: 1015, clientY: 310 });
    const tooltip = screen.getByRole('status');
    expect(Number.parseFloat(tooltip.style.left) + 160).toBeLessThan(1000);
    expect(Number.parseFloat(tooltip.style.top) + 44).toBeLessThan(216);
    expect(tooltip).not.toHaveTextContent('Camera B');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('labels camera fallback separately from a real lens with the same name and filters its key', async () => {
  const fallback = JSON.stringify(['camera', 'Phone A']);
  const real = JSON.stringify(['lens', 'Phone A']);
  get.mockResolvedValue({
    ...data,
    lensOptions: [fallback, real],
    lenses: [
      { key: fallback, count: 4 },
      { key: real, count: 2 },
    ],
  });
  mount();
  await screen.findByRole('button', { name: /Phone A（未记录镜头）/ });
  fireEvent.click(screen.getByRole('button', { name: /Phone A（未记录镜头）/ }));
  await waitFor(() => expect(get.mock.calls.at(-1)?.[0].lenses).toEqual([fallback]));
  expect(screen.getByRole('button', { name: '镜头：Phone A' })).toBeInTheDocument();
});
