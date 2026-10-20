import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhotoFilterOptions } from './PhotoFilterOptions';
const repository = vi.hoisted(() => ({
  listPhotoLuts: vi.fn(async () => [{ id: 'personal', name: '个人 LUT', size: 2 }]),
  importPhotoLut: vi.fn(async () => ({ id: 'new', name: '新 LUT', size: 2 })),
}));
vi.mock('./photo-lut-storage', () => repository);
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('lists local LUTs beside built-ins and imports multiple files without selecting or uploading them', async () => {
  const onChange = vi.fn();
  render(<PhotoFilterOptions selected="original" disabled={false} onChange={onChange} />);
  await screen.findByRole('button', { name: '个人 LUT' });
  fireEvent.click(screen.getByRole('button', { name: '个人 LUT' }));
  expect(onChange).toHaveBeenLastCalledWith('lut:personal');
  const files = [new File(['a'], 'one.cube'), new File(['b'], 'two.png')];
  fireEvent.change(screen.getByLabelText('导入 LUT'), { target: { files } });
  await waitFor(() => expect(repository.importPhotoLut).toHaveBeenCalledTimes(2));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '原图' })).toHaveAttribute('aria-pressed', 'true');
});
it('reports a failed import and keeps the existing local library usable', async () => {
  repository.importPhotoLut.mockRejectedValueOnce(new Error('INVALID_LUT'));
  render(<PhotoFilterOptions selected="original" disabled={false} onChange={vi.fn()} />);
  await screen.findByRole('button', { name: '个人 LUT' });
  fireEvent.change(screen.getByLabelText('导入 LUT'), {
    target: { files: [new File(['bad'], 'bad.cube')] },
  });
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '个人 LUT' })).toBeEnabled();
});

it('opens the picker, ignores cancellation and rejects oversized batches before reading files', async () => {
  render(<PhotoFilterOptions selected="original" disabled={false} onChange={vi.fn()} />);
  const input = screen.getByLabelText('导入 LUT');
  const click = vi.spyOn(input, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: '导入 LUT' }));
  expect(click).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { files: [] } });
  expect(repository.importPhotoLut).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: Array(129).fill(new File(['x'], 'one.cube')) } });
  expect(await screen.findByRole('alert')).toHaveTextContent('128');
  expect(repository.importPhotoLut).not.toHaveBeenCalled();
});

it('reports a local library read failure', async () => {
  repository.listPhotoLuts.mockRejectedValueOnce(new Error('blocked'));
  render(<PhotoFilterOptions selected="original" disabled={false} onChange={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('本地滤镜读取失败');
});

it('navigates a continuous grouped strip without changing the selected filter', async () => {
  repository.listPhotoLuts.mockResolvedValueOnce([
    { id: 'priority', name: 'Favorite', size: 2, group: 'Priority', groupOrder: 0 },
    { id: 'film', name: 'Film LUT', size: 2, group: 'Film', groupOrder: 1 },
  ]);
  const onChange = vi.fn();
  render(<PhotoFilterOptions selected="original" disabled={false} onChange={onChange} />);
  await screen.findByRole('button', { name: 'Favorite' });
  const row = screen.getByRole('group', { name: '照片滤镜' });
  const buttons = Array.from(row.querySelectorAll('button'));
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
    '原图',
    'Favorite',
    'Film LUT',
    '复古',
    '清冷',
    '黑白',
  ]);
  Object.defineProperties(row, { clientWidth: { value: 100 }, scrollWidth: { value: 600 } });
  const bounds = (left: number) => ({
    left,
    right: left + 90,
    top: 0,
    bottom: 100,
    width: 90,
    height: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => bounds(0));
  buttons.forEach((button, index) =>
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => bounds(index * 100)),
  );
  const scrollTo = vi.fn();
  Object.defineProperty(row, 'scrollTo', { value: scrollTo });
  fireEvent.click(screen.getByRole('button', { name: 'Film', exact: true }));
  expect(scrollTo).toHaveBeenCalledWith({ left: 200, behavior: 'smooth' });
  expect(screen.getByRole('button', { name: 'Film', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Favorite' })).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});
