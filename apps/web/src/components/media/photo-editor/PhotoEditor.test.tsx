import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoEditor } from './PhotoEditor';
import { PHOTO_ADJUSTMENTS } from './photo-adjustment-catalog';

vi.mock('./photo-editor-metadata', () => ({
  readPhotoMetadata: async () => ({
    camera: 'Nikon D80',
    parameters: '24mm · f/4',
    capturedAt: '2026.10.19 10:30',
  }),
}));
vi.mock('./photo-editor-watermark', () => ({
  renderPhotoWatermark: (source: HTMLCanvasElement) => source,
}));

vi.mock('./photo-editor-render', () => ({
  MAX_PHOTO_PIXELS: 48_000_000,
  sourceCanvas: () => Object.assign(document.createElement('canvas'), { width: 800, height: 600 }),
  drawPhoto: (target: HTMLCanvasElement) => {
    target.width = 800;
    target.height = 600;
  },
  composePhoto: (target: HTMLCanvasElement) => {
    target.width = 800;
    target.height = 600;
  },
  createPhotoRenderer: () => ({
    render: async () => document.createElement('canvas'),
    dispose: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
  );
  class TestImage {
    naturalWidth = 800;
    naturalHeight = 600;
    onload: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', TestImage);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

describe('photo editor interactions', () => {
  it('keeps precision adjustment arrow keys inside the editor instead of navigating the gallery behind it', async () => {
    const galleryNavigation = vi.fn();
    window.addEventListener('keydown', galleryNavigation);
    try {
      render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
      const exposure = screen.getByRole('slider', { name: '曝光' });
      await waitFor(() => expect(exposure).toBeEnabled());
      fireEvent.keyDown(exposure, { key: 'ArrowRight' });
      expect(galleryNavigation).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', galleryNavigation); }
  });
  it('supports free and fixed framing, resize handles, undo, reset and extra aspect ratios', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    expect(screen.queryByRole('slider', { name: '缩放' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(11);
    fireEvent.change(screen.getByRole('combobox', { name: '裁剪比例' }), {
      target: { value: '9:16' },
    });
    fireEvent.click(screen.getByRole('button', { name: '自由' }));
    expect(screen.queryByRole('combobox', { name: '裁剪比例' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自由' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '裁剪右下角' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('combobox', { name: '裁剪比例' })).toHaveValue('9:16');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('button', { name: '自由' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '固定比例' }));
    expect(screen.getByRole('combobox', { name: '裁剪比例' })).toHaveValue('9:16');
    fireEvent.click(screen.getByRole('button', { name: '重置裁剪' }));
    expect(screen.getByRole('combobox', { name: '裁剪比例' })).toHaveValue('original');
  });
  it('reopens a full-resolution framed photo larger than the old 24 megapixel limit', async () => {
    class FramedImage {
      naturalWidth = 6360;
      naturalHeight = 3836;
      onload: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FramedImage);
    render(
      <PhotoEditor source="/edited.png" name="Edited.png" onClose={vi.fn()} onSave={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps existing adjustments when switching categories and remembers each selected parameter', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    const exposure = screen.getByRole('slider', { name: '曝光' });
    await waitFor(() => expect(exposure).toBeEnabled());
    fireEvent.change(exposure, { target: { value: '0.2' } });
    fireEvent.click(screen.getByRole('button', { name: '色彩' }));
    fireEvent.change(screen.getByRole('slider', { name: '饱和度' }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '影调' }));
    expect(screen.getByRole('slider', { name: '曝光' })).toHaveValue('0.2');
    fireEvent.click(screen.getByRole('button', { name: '对比度' }));
    fireEvent.change(screen.getByRole('slider', { name: '对比度' }), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '色彩' }));
    expect(screen.getByRole('slider', { name: '饱和度' })).toHaveValue('12');
    fireEvent.click(screen.getByRole('button', { name: '影调' }));
    expect(screen.getByRole('slider', { name: '对比度' })).toHaveValue('8');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('slider', { name: '对比度' })).toHaveValue('0');
  });
  it('connects every adjustment, remembers values and supports single-parameter reset', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    for (const [id, label] of [
      ['tone', '影调'],
      ['color', '色彩'],
      ['detail', '细节'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      for (const option of PHOTO_ADJUSTMENTS.filter((item) => item.group === id)) {
        const button = screen.getByRole('button', { name: option.label });
        fireEvent.click(button);
        const control = screen.getByRole('slider', { name: option.label });
        expect(control).toBeEnabled();
        fireEvent.change(control, { target: { value: option.id === 'exposure' ? '0.2' : '20' } });
        expect(button).toHaveTextContent(option.id === 'exposure' ? '+0.20' : '+20');
        fireEvent.doubleClick(button);
        expect(control).toHaveValue('0');
      }
    }
    expect(screen.queryByText('待接入')).not.toBeInTheDocument();
  }, 15_000);
  it('supports press-and-hold original comparison and restores editing on release', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    const button = screen.getByRole('button', { name: '对比原图' });
    fireEvent(button, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '保存到相册' })).toBeDisabled();
    fireEvent(button, new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
  it('edits watermark text as one undoable operation and can remove the frame', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '水印' }));
    fireEvent.click(screen.getByRole('button', { name: '摄影信息条' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
    fireEvent.change(screen.getByRole('textbox', { name: '签名文字' }), {
      target: { value: 'My photo' },
    });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(screen.queryByRole('dialog', { name: '水印设置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
    expect(screen.getByRole('textbox', { name: '签名文字' })).toHaveValue('');
    fireEvent.keyDown(screen.getByRole('textbox', { name: '签名文字' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '水印设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '无水印' }));
    expect(screen.getByRole('button', { name: '无水印' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('limits the exposure drag span to two stops and provides 0.01 EV nudges', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    const exposure = screen.getByRole('slider', { name: '曝光' });
    await waitFor(() => expect(exposure).toBeEnabled());
    expect(exposure).toHaveAttribute('min', '-1');
    expect(exposure).toHaveAttribute('max', '1');
    expect(exposure).toHaveAttribute('step', '0.01');
    fireEvent.click(screen.getByRole('button', { name: '增加曝光' }));
    expect(exposure).toHaveValue('0.01');
    expect(exposure).toHaveAttribute('aria-valuetext', '0.01 EV');
    fireEvent.keyDown(exposure, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyUp(exposure, { key: 'ArrowRight', shiftKey: true });
    expect(exposure).toHaveValue('0.11');
    const number = screen.getByRole('spinbutton', { name: '曝光数值' });
    fireEvent.change(number, { target: { value: '0.15' } });
    fireEvent.blur(number);
    expect(exposure).toHaveValue('0.15');
    fireEvent.change(number, { target: { value: '5' } });
    fireEvent.blur(number);
    expect(exposure).toHaveValue('1');
    fireEvent.change(number, { target: { value: '5' } });
    fireEvent.blur(number);
    expect(number).toHaveValue(1);
    fireEvent.doubleClick(exposure);
    expect(exposure).toHaveValue('0');
  });
  it('resets only photo adjustments while keeping crop and watermark choices', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    fireEvent.change(screen.getByRole('combobox', { name: '裁剪比例' }), {
      target: { value: '1:1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '水印' }));
    fireEvent.click(screen.getByRole('button', { name: '摄影信息条' }));
    fireEvent.click(screen.getByRole('button', { name: '调整' }));
    fireEvent.change(screen.getByRole('slider', { name: '曝光' }), { target: { value: '0.2' } });
    fireEvent.click(screen.getByRole('button', { name: '重置全部' }));
    expect(screen.getByRole('slider', { name: '曝光' })).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    expect(screen.getByRole('combobox', { name: '裁剪比例' })).toHaveValue('1:1');
    fireEvent.click(screen.getByRole('button', { name: '水印' }));
    expect(screen.getByRole('button', { name: '摄影信息条' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('saves a marked PNG to the supplied album adapter instead of starting a download', async () => {
    const save = vi.fn().mockResolvedValue({ id: 'saved', name: 'Photo-已编辑.png' });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['png'], { type: 'image/png' })),
    );
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={save} />);
    const button = screen.getByRole('button', { name: '保存到相册' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const file = save.mock.calls[0][0] as File;
    expect(file.type).toBe('image/png');
    expect(file.name).toMatch(/^Photo-已编辑-.*\.png$/);
    await waitFor(() => expect(screen.getByRole('button', { name: '已保存' })).toBeDisabled());
    expect(document.querySelector('a[download]')).toBeNull();
  });
  it('does not save the full crop workspace or the original comparison as the edited result', async () => {
    const save = vi.fn();
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={save} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存到相册' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    fireEvent.change(screen.getByRole('combobox', { name: '裁剪比例' }), {
      target: { value: '1:1' },
    });
    const done = screen.getByRole('button', { name: '完成裁剪' });
    await waitFor(() => expect(done).toBeEnabled());
    fireEvent.click(done);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('成片预览')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '保存到相册' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '对比原图' }));
    expect(screen.getByRole('button', { name: '保存到相册' })).toBeDisabled();
  });
  it('keeps failed saves retryable and retains unsaved changes', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ id: 'saved', name: 'Photo-edited.png' });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['png'], { type: 'image/png' })),
    );
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={save} />);
    const button = screen.getByRole('button', { name: '保存到相册' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('照片保存失败'));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toBe(save.mock.calls[0][0]);
  });
  it('supports adjustments, undo, redo and reset without closing the photo', async () => {
    render(<PhotoEditor onSave={vi.fn()} source="/photo.png" name="Photo.png" onClose={vi.fn()} />);
    const exposure = screen.getByRole('slider', { name: '曝光' });
    await waitFor(() => expect(exposure).toBeEnabled());
    fireEvent.change(exposure, { target: { value: '0.3' } });
    expect(exposure).toHaveValue('0.3');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(exposure).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(exposure).toHaveValue('0.3');
    fireEvent.click(screen.getByRole('button', { name: '重置全部' }));
    expect(exposure).toHaveValue('0');
  });
  it('coalesces a complete slider gesture into a single undo step', async () => {
    render(<PhotoEditor onSave={vi.fn()} source="/photo.png" name="Photo.png" onClose={vi.fn()} />);
    const exposure = screen.getByRole('slider', { name: '曝光' });
    await waitFor(() => expect(exposure).toBeEnabled());
    fireEvent.pointerDown(exposure);
    fireEvent.change(exposure, { target: { value: '0.1' } });
    fireEvent.change(exposure, { target: { value: '0.25' } });
    fireEvent.pointerUp(exposure);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(exposure).toHaveValue('0');
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });
  it('guards unsaved edits on Escape before closing and makes the editor behind the prompt inert', async () => {
    const close = vi.fn();
    render(<PhotoEditor onSave={vi.fn()} source="/photo.png" name="Photo.png" onClose={close} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.change(screen.getByRole('slider', { name: '曝光' }), { target: { value: '0.2' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(document.querySelector('header')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭编辑器' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(close).toHaveBeenCalledOnce();
  });
});
