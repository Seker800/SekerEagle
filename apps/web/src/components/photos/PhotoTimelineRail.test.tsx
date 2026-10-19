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
    const middleYear = screen.getByText('2023');
    expect(parseFloat(middleYear.style.top)).toBeCloseTo(14.56, 1);
    const slider = screen.getByRole('slider');
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 500 } as DOMRect);
    fireEvent.click(slider, { clientY: 0 });
    expect(onJump).toHaveBeenLastCalledWith(months[0]);
    fireEvent.click(slider, { clientY: 1000 });
    expect(onJump).toHaveBeenLastCalledWith(months[2]);
  });
});


it('renders calendar month ruler marks and magnifies only the ticks near the pointer without a popup', () => {
  render(<PhotoTimelineRail months={months} onJump={vi.fn()} onLatest={vi.fn()} onRetry={vi.fn()} />);
  const slider = screen.getByRole('slider');
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({top: 100, height: 500} as DOMRect);
  const marks = slider.querySelectorAll('[data-ruler-month]');
  expect(marks.length).toBe(310);
  const major = slider.querySelector('[data-ruler-month="2025-01"]')!;
  const minor = slider.querySelector('[data-ruler-month="2025-02"]')!;
  expect(major).toHaveAttribute('data-major', 'true');
  expect(minor).toHaveAttribute('data-major', 'false');
  const restingWidth = parseFloat((major as HTMLElement).style.width);
  fireEvent.pointerMove(slider, {clientY: 100 + parseFloat((major as HTMLElement).style.top) * 5});
  expect(parseFloat((major as HTMLElement).style.width)).toBeGreaterThan(restingWidth);
  expect(screen.getByRole('tooltip')).toHaveTextContent(/年.*月/);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.pointerLeave(slider);
  expect((major as HTMLElement).style.width).toBe(`${restingWidth}px`);
});
it('keeps calendar year labels equally spaced with uneven photo dates', () => {
  render(<PhotoTimelineRail months={[
    {month:'2026-10',count:1,cursor:'new'}, {month:'2025-11',count:1,cursor:'middle'},
    {month:'2024-03',count:1,cursor:'older'}, {month:'2023-01',count:1,cursor:'old'},
  ]} onJump={vi.fn()} onLatest={vi.fn()} onRetry={vi.fn()} />);
  const positions = ['2026','2025','2024'].map(year => parseFloat(screen.getByText(year).style.top));
  expect(positions[1]-positions[0]).toBeCloseTo(positions[2]-positions[1]);
});
