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
  it('keeps real endpoints while compressing empty years', () => {
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
    expect(screen.queryByText('2023')).not.toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-break')).toHaveLength(2);
    const slider = screen.getByRole('slider');
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 500 } as DOMRect);
    fireEvent.click(slider, { clientY: 0 });
    expect(onJump).toHaveBeenLastCalledWith(months[0]);
    fireEvent.click(slider, { clientY: 1000 });
    expect(onJump).toHaveBeenLastCalledWith(months[2]);
  });
});

it('renders calendar month ruler marks and magnifies only the ticks near the pointer without a popup', () => {
  render(
    <PhotoTimelineRail months={months} onJump={vi.fn()} onLatest={vi.fn()} onRetry={vi.fn()} />,
  );
  const slider = screen.getByRole('slider');
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 500 } as DOMRect);
  const marks = slider.querySelectorAll('[data-ruler-month]');
  expect(marks.length).toBe(months.length);
  expect(slider.querySelector('[data-ruler-month="2025-01"]')).toBeNull();
  const major = slider.querySelector('[data-ruler-month="2001-01"]')!;
  const minor = slider.querySelector('[data-ruler-month="2024-03"]')!;
  expect(major).toHaveAttribute('data-major', 'true');
  expect(minor).toHaveAttribute('data-major', 'true');
  const restingWidth = parseFloat((major as HTMLElement).style.width);
  fireEvent.pointerMove(slider, {
    clientY: 100 + parseFloat((major as HTMLElement).style.top) * 5,
  });
  expect(parseFloat((major as HTMLElement).style.width)).toBeGreaterThan(restingWidth);
  expect(screen.getByRole('tooltip')).toHaveTextContent(/年.*月/);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.pointerLeave(slider);
  expect((major as HTMLElement).style.width).toBe(`${restingWidth}px`);
});
it('uses the same compressed positions for hover, click and the current month indicator', () => {
  const onJump = vi.fn();
  render(
    <PhotoTimelineRail
      months={months}
      currentMonth="2024-03"
      onJump={onJump}
      onLatest={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  const slider = screen.getByRole('slider');
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 500 } as DOMRect);
  for (const month of months) {
    const tick = slider.querySelector<HTMLElement>(`[data-ruler-month="${month.month}"]`)!;
    const clientY = 100 + parseFloat(tick.style.top) * 5;
    fireEvent.pointerMove(slider, { clientY });
    expect(screen.getByRole('tooltip')).toHaveAttribute('dateTime', month.month);
    fireEvent.click(slider, { clientY });
    expect(onJump).toHaveBeenLastCalledWith(month);
  }
  const current = slider.querySelector<HTMLElement>('[data-ruler-month="2024-03"]')!;
  expect(slider.querySelector('[data-current-month]')).toHaveStyle({ top: current.style.top });
});

it('limits labels in a long library without dropping any navigable month', () => {
  const manyMonths = Array.from({ length: 100 }, (_, index) => ({
    month: `${2026 - index}-06`,
    count: 1,
    cursor: `${index}`,
  }));
  render(
    <PhotoTimelineRail months={manyMonths} onJump={vi.fn()} onLatest={vi.fn()} onRetry={vi.fn()} />,
  );
  const slider = screen.getByRole('slider');
  expect(slider.querySelectorAll('[data-ruler-month]')).toHaveLength(100);
  expect(slider.querySelectorAll('[data-ruler-year]').length).toBeLessThanOrEqual(13);
  expect(slider).toHaveAttribute('aria-valuemax', '99');
});
