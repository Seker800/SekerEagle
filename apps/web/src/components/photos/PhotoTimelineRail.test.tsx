import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PhotoTimelineRail } from './PhotoTimelineRail';
const months = [
  { month: '2026-10', count: 20, cursor: 'new' },
  { month: '2024-03', count: 9, cursor: 'old' },
  { month: '2001-01', count: 2, cursor: 'oldest' },
];
describe('PhotoTimelineRail', () => {
  it('shows year ticks, reveals the hovered month, and jumps directly to that month cursor', () => {
    const onJump = vi.fn(),
      onLatest = vi.fn();
    render(
      <PhotoTimelineRail
        months={months}
        currentMonth="2024-03"
        onJump={onJump}
        onLatest={onLatest}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('2026/10')).toBeInTheDocument();
    const track = screen.getByRole('slider', { name: '按年月跳转' });
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 500 } as DOMRect);
    fireEvent.pointerMove(track, { clientY: 350 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('2024年3月');
    expect(screen.getByRole('tooltip')).toHaveTextContent('9 张照片');
    fireEvent.click(track, { clientY: 350 });
    expect(onJump).toHaveBeenLastCalledWith(months[1]);
    fireEvent.keyDown(track, { key: 'End' });
    expect(onJump).toHaveBeenLastCalledWith(months[2]);
    fireEvent.keyDown(track, { key: 'Home' });
    expect(onJump).toHaveBeenLastCalledWith(months[0]);
    fireEvent.keyDown(track, { key: 'ArrowDown' });
    expect(onJump).toHaveBeenLastCalledWith(months[1]);
    fireEvent.keyDown(track, { key: 'ArrowUp' });
    expect(onJump).toHaveBeenLastCalledWith(months[0]);
    fireEvent.pointerLeave(track);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(track);
    expect(screen.getByRole('tooltip')).toHaveTextContent('2024年3月');
    fireEvent.blur(track);
    fireEvent.click(screen.getByRole('button', { name: '回到最新照片' }));
    expect(onLatest).toHaveBeenCalledOnce();
  });
  it('supports an empty/single month, loading and retry without fabricated dates', () => {
    const onRetry = vi.fn();
    const props = { onJump: vi.fn(), onLatest: vi.fn(), onRetry };
    const view = render(<PhotoTimelineRail {...props} months={[]} loading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    view.rerender(<PhotoTimelineRail {...props} months={[]} error />);
    fireEvent.click(screen.getByRole('button', { name: '重试日期导航' }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(<PhotoTimelineRail {...props} months={[]} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    view.rerender(<PhotoTimelineRail {...props} months={[months[0]]} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(props.onJump).toHaveBeenLastCalledWith(months[0]);
    fireEvent.keyDown(slider, { key: 'Escape' });
  });
  it('uses the real photo date range for both endpoints and proportional month positions', () => {
    const onJump = vi.fn();
    render(
      <PhotoTimelineRail months={months} onJump={onJump} onLatest={vi.fn()} onRetry={vi.fn()} />,
    );
    const latest = screen.getByText('2026/10');
    const earliest = screen.getByText('2001/01');
    expect(latest).toHaveAttribute('dateTime', '2026-10');
    expect(earliest).toHaveAttribute('dateTime', '2001-01');
    expect(latest).toHaveStyle({ top: '0%' });
    expect(earliest).toHaveStyle({ top: '100%' });
    const middleYear = screen.getByText('2024');
    expect(parseFloat(middleYear.style.top)).toBeCloseTo(10.03, 1);
    const slider = screen.getByRole('slider');
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 500 } as DOMRect);
    fireEvent.click(slider, { clientY: 0 });
    expect(onJump).toHaveBeenLastCalledWith(months[0]);
    fireEvent.click(slider, { clientY: 1000 });
    expect(onJump).toHaveBeenLastCalledWith(months[2]);
  });
});

describe('calendar month selection', () => {
  const sparseMonths = [
    { month: '2026-10', count: 20, cursor: 'october' },
    { month: '2026-02', count: 8, cursor: 'february' },
    { month: '2025-11', count: 9, cursor: 'november' },
    { month: '2024-03', count: 2, cursor: 'march' },
    { month: '2023-01', count: 1, cursor: 'january' },
  ];
  it('reveals a selectable month grid and jumps with the exact existing month cursor', () => {
    const onJump = vi.fn();
    render(<PhotoTimelineRail months={sparseMonths} onJump={onJump} onLatest={vi.fn()} onRetry={vi.fn()} />);
    const slider = screen.getByRole('slider');
    fireEvent.focus(slider);
    const picker = screen.getByRole('navigation', { name: '按年月跳转' });
    expect(picker.querySelectorAll('button')).toHaveLength(12);
    const february = screen.getByRole('button', { name: '2026年2月', exact: true });
    expect(february).toBeEnabled();
    expect(screen.getByRole('button', { name: '2026年3月', exact: true })).toBeDisabled();
    fireEvent.click(february);
    expect(onJump).toHaveBeenCalledExactlyOnceWith(sparseMonths[1]);
    expect(slider).toHaveAttribute('aria-valuetext', '2026年2月');
    fireEvent.keyDown(picker, {key: 'Escape'});
    expect(screen.queryByRole('navigation', { name: '按年月跳转' })).not.toBeInTheDocument();
  });
  it('anchors every year to the same calendar boundary despite uneven photo dates', () => {
    render(<PhotoTimelineRail months={sparseMonths} onJump={vi.fn()} onLatest={vi.fn()} onRetry={vi.fn()} />);
    const positions = ['2026', '2025', '2024'].map(year => parseFloat(screen.getByText(year, {exact: true}).style.top));
    expect(positions[1] - positions[0]).toBeCloseTo(positions[2] - positions[1], 5);
    expect(screen.getByText('2026/10')).toHaveStyle({top: '0%'});
    expect(screen.getByText('2023/01')).toHaveStyle({top: '100%'});
  });
  it('keeps the picker open when focus moves from the slider to a month button', () => {
    render(<PhotoTimelineRail months={sparseMonths} onJump={vi.fn()} onLatest={vi.fn()} onRetry={vi.fn()} />);
    const slider = screen.getByRole('slider');
    fireEvent.focus(slider);
    const month = screen.getByRole('button', {name: '2026年2月'});
    fireEvent.blur(slider, {relatedTarget: month});
    fireEvent.focus(month);
    expect(screen.getByRole('navigation', {name: '按年月跳转'})).toBeVisible();
    fireEvent.blur(month, {relatedTarget: document.body});
    expect(screen.queryByRole('navigation', {name: '按年月跳转'})).not.toBeInTheDocument();
  });
});
