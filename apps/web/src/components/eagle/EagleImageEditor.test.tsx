import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EagleImageEditor } from './EagleImageEditor';

const asset = {
  id: 'image',
  displayName: 'Test',
  rowVersion: 2,
  mediaRevision: 1,
  width: 800,
  height: 400,
};
function setup(save = vi.fn().mockResolvedValue({ assetId: 'copy' })) {
  const onClose = vi.fn(),
    onSaved = vi.fn();
  render(
    <EagleImageEditor
      asset={asset}
      previewUrl="/preview"
      onSave={save}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  const image = screen.getByAltText('编辑预览');
  Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 400 } });
  fireEvent.load(image);
  return { save, onClose, onSaved };
}
describe('image editing', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('PointerEvent', MouseEvent);
  });
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
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ assetId: 'copy' });
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
  it('applies crop ratios and numeric source coordinates to the saved recipe', async () => {
    const { save } = setup();
    fireEvent.change(screen.getByRole('combobox', { name: '裁剪比例' }), { target: { value: '1' } });
    expect(screen.getByText('400 × 400')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: /裁剪高度/ }), { target: { value: '50' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /裁剪宽度/ }), { target: { value: '25' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /左边距/ }), { target: { value: '10' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /上边距/ }), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: '完成裁剪' }));
    fireEvent.click(screen.getByRole('button', { name: '保存副本' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ edit: expect.objectContaining({ crop: { x: .1, y: .2, width: .25, height: .5 } }) })));
  });
  it('draws a crop selection and cancels an interrupted drag', async () => {
    const { save } = setup();
    fireEvent.click(screen.getByRole('button', { name: '裁剪', exact: true }));
    const stage = screen.getByAltText('编辑预览').parentElement!;
    stage.setPointerCapture = vi.fn();
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 400 } as DOMRect);
    fireEvent.pointerDown(stage, { clientX: 80, clientY: 40, button: 0 });
    fireEvent.pointerMove(stage, { clientX: 480, clientY: 240 });
    fireEvent.pointerCancel(stage);
    expect(screen.getByText('800 × 400')).toBeInTheDocument();
    fireEvent.pointerDown(stage, { clientX: 80, clientY: 40, button: 0 });
    fireEvent.pointerMove(stage, { clientX: 480, clientY: 240 });
    fireEvent.pointerUp(stage, { clientX: 480, clientY: 240 });
    expect(screen.getByText('400 × 200')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存副本' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ edit: expect.objectContaining({ crop: { x: .1, y: .1, width: .5, height: .5 } }) })));
  });
  it('keeps one in-flight save and prevents closing or changing a pending edit', async () => {
    let resolve!: (value: { assetId: string }) => void;
    const { save, onClose } = setup(vi.fn(() => new Promise(next => { resolve = next; })));
    fireEvent.click(screen.getByRole('button', { name: '垂直翻转' }));
    const dialog = screen.getByRole('dialog', { name: '图片编辑' });
    fireEvent.keyDown(dialog, { key: 's', ctrlKey: true });
    fireEvent.keyDown(dialog, { key: 's', ctrlKey: true });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(save).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '向右旋转' })).toBeDisabled();
    resolve({ assetId: 'copy' });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存副本' })).toBeEnabled());
  });
  it('retries previews, compares the source, and keeps focus inside the dialog', () => {
    setup();
    fireEvent.error(screen.getByAltText('编辑预览'));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载编辑预览');
    fireEvent.load(screen.getByAltText('编辑预览'));
    fireEvent.click(screen.getByRole('button', { name: '对比原图' }));
    expect(screen.getByAltText('编辑预览')).toBeVisible();
    const dialog = screen.getByRole('dialog', { name: '图片编辑' });
    dialog.focus(); fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '关闭编辑器' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '向左旋转' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
