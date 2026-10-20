import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PhotoFilterOptions } from './PhotoFilterOptions';
const repository = vi.hoisted(() => ({
  listPhotoLuts: vi.fn(async () => [{ id: 'personal', name: '个人 LUT', size: 2 }]),
  importPhotoLut: vi.fn(async () => ({ id: 'new', name: '新 LUT', size: 2 })),
}));
vi.mock('./photo-lut-storage', () => repository);
afterEach(() => {
  cleanup();
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
