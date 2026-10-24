import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhotoStatistics } from './PhotoStatistics';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/photo-statistics-api', () => ({ getPhotoStatistics: get }));
const data = { total: 6, unknownDate: 1, grain: 'month', groupBy: 'camera', periods: ['2024-01', '2024-02', '2024-03'], cameraOptions: ['Camera A', 'Camera B', ''], lensOptions: ['Lens A'], cameras: [{ key: 'Camera A', count: 6 }], lenses: [{ key: 'Lens A', count: 6 }], points: [{ period: '2024-01', key: 'Camera A', count: 5 }] };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PhotoStatistics ownerId="owner" includePrivate={false} /></QueryClientProvider>);
}
beforeEach(() => get.mockReset());
describe('photo statistics', () => {
  it('shows three charts, calendar gaps, totals and unknown dates', async () => {
    get.mockResolvedValue(data); mount();
    expect(await screen.findByRole('img', { name: '拍摄量折线图' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '相机使用量柱状图' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '镜头使用量柱状图' })).toBeInTheDocument();
    expect(screen.getByText('拍摄日期未知')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('查看时间段'), { target: { value: '1' } });
    expect(screen.getByText('2024-02', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Camera A：0')).toBeInTheDocument();
  });
  it('combines camera and lens filters and switches the time series dimension', async () => {
    get.mockResolvedValue(data); mount(); await screen.findByRole('img', { name: '拍摄量折线图' });
    fireEvent.click(screen.getByLabelText('Camera A'));
    fireEvent.click(screen.getByLabelText('Lens A'));
    fireEvent.change(screen.getByLabelText('曲线分组'), { target: { value: 'lens' } });
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toMatchObject({ cameras: ['Camera A'], lenses: ['Lens A'], groupBy: 'lens' }));
  });
  it('offers retry without presenting stale charts after a failed query', async () => {
    get.mockRejectedValue(new Error('Offline')); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    get.mockResolvedValue({ ...data, total: 0, periods: [], points: [], cameras: [], lenses: [] });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('当前条件下没有照片')).toBeInTheDocument();
  });
});
