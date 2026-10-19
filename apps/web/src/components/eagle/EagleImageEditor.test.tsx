import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EagleImageEditor } from './EagleImageEditor';

const asset = { id: 'image', displayName: 'Test', rowVersion: 2, mediaRevision: 1, width: 800, height: 400 };
function setup(save = vi.fn().mockResolvedValue({ assetId: 'copy' })) {
  const onClose = vi.fn(), onSaved = vi.fn();
  render(<EagleImageEditor asset={asset} previewUrl="/preview" onSave={save} onClose={onClose} onSaved={onSaved} />);
  fireEvent.load(screen.getByAltText('编辑预览'));
  return { save, onClose, onSaved };
}
describe('image editing', () => {
  it('supports rotations, flips, crop, color, undo, redo and reset', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '向右旋转' }));
    expect(screen.getByText('400 × 800')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByText('800 × 400')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    fireEvent.change(screen.getByLabelText('亮度'), { target: { value: '1.2' } });
    fireEvent.click(screen.getByRole('button', { name: '重置编辑' }));
    expect(screen.getByLabelText('亮度')).toHaveValue('1');
    expect(screen.getByText('800 × 400')).toBeInTheDocument();
  });
  it('retries the same operation after a failed save and preserves the draft', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ assetId: 'copy' });
    const { onSaved } = setup(save);
    fireEvent.click(screen.getByRole('button', { name: '水平翻转' }));
    fireEvent.click(screen.getByRole('button', { name: '保存副本' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    const first = save.mock.calls[0]?.[0];
    fireEvent.click(screen.getByRole('button', { name: '保存副本' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('copy'));
    expect(save.mock.calls[1]?.[0]).toEqual(first);
    expect(first.edit.flipX).toBe(true);
    expect(first.rowVersion).toBe(2);
  });
  it('requires a deliberate discard and never saves an unchanged image', () => {
    const { onClose } = setup();
    expect(screen.getByRole('button', { name: '保存副本' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '向右旋转' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭编辑器' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('reports preview failure and disables saving', () => {
    setup();
    fireEvent.error(screen.getByAltText('编辑预览'));
    expect(screen.getByRole('alert')).toHaveTextContent('预览加载失败');
    expect(screen.getByRole('button', { name: '保存副本' })).toBeDisabled();
  });
});
