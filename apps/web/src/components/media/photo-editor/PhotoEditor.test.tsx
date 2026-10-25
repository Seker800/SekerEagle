import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoEditor } from './PhotoEditor';
import { readPhotoMetadata } from './photo-editor-metadata';
import { composePhoto, sourceCanvas } from './photo-editor-render';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';
import { PHOTO_ADJUSTMENTS } from './photo-adjustment-catalog';

vi.mock('./photo-editor-metadata', () => ({
  readPhotoMetadata: vi.fn(async () => ({
    camera: 'Nikon D80',
    parameters: '24mm · f/4',
    capturedAt: '2026.10.19 10:30',
  })),
}));
vi.mock('./photo-editor-watermark', () => ({
  renderPhotoWatermark: (source: HTMLCanvasElement) => source,
}));

vi.mock('./photo-editor-render', () => ({
  MAX_PHOTO_PIXELS: 48_000_000,
  sourceCanvas: vi.fn(() =>
    Object.assign(document.createElement('canvas'), { width: 800, height: 600 }),
  ),
  drawPhoto: (target: HTMLCanvasElement) => {
    target.width = 800;
    target.height = 600;
  },
  composePhoto: vi.fn((target: HTMLCanvasElement) => {
    target.width = 800;
    target.height = 600;
  }),
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
      render(
        <PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />,
      );
      const exposure = screen.getByRole('slider', { name: '曝光' });
      await waitFor(() => expect(exposure).toBeEnabled());
      fireEvent.keyDown(exposure, { key: 'ArrowRight' });
      expect(galleryNavigation).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', galleryNavigation);
    }
  });
  it('starts free, explicitly selects ratios in either orientation, and supports undo and reset', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    expect(screen.getByRole('button', { name: '自由' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '纵向' }));
    expect(screen.getByRole('button', { name: '自由' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '9:16' }));
    expect(screen.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '横向' }));
    expect(screen.getByRole('button', { name: '16:9' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('button', { name: '16:9' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '自由' }));
    expect(screen.getByRole('button', { name: '裁剪右下角' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '重置裁剪' }));
    expect(screen.getByRole('button', { name: '自由' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '纵向' }));
    for (const ratio of ['1:1', '3:4', '2:3', '4:5', '9:16', '9:21']) {
      fireEvent.click(screen.getByRole('button', { name: ratio }));
      expect(screen.getByRole('button', { name: ratio })).toHaveAttribute('aria-pressed', 'true');
    }
    fireEvent.click(screen.getByRole('button', { name: '原始比例' }));
    expect(screen.getByRole('button', { name: '原始比例' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('supports negative sharpening and clarity with undo and reset', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '细节' }));
    for (const label of ['锐化', '清晰度']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      const slider = screen.getByRole('slider', { name: label });
      expect(slider).toHaveAttribute('min', '-100');
      fireEvent.change(slider, { target: { value: '-60' } });
      expect(slider).toHaveValue('-60');
      fireEvent.click(screen.getByRole('button', { name: '撤销' }));
      expect(slider).toHaveValue('0');
      fireEvent.click(screen.getByRole('button', { name: '重做' }));
      expect(slider).toHaveValue('-60');
      fireEvent.doubleClick(slider);
      expect(slider).toHaveValue('0');
    }
  });
  it('presents filters in a scrollable row and retains strength when switching filters', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '滤镜' }));
    expect(screen.getByRole('group', { name: '照片滤镜' })).toHaveAttribute('tabindex', '0');
    fireEvent.click(screen.getByRole('button', { name: '复古' }));
    fireEvent.change(screen.getByRole('slider', { name: '滤镜强度' }), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: '黑白' }));
    expect(screen.getByRole('slider', { name: '滤镜强度' })).toHaveValue('42');
    fireEvent.click(screen.getByRole('button', { name: '原图' }));
    expect(screen.getByRole('slider', { name: '滤镜强度' })).toBeDisabled();
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
  it('keeps tone, color and detail in one continuous tool strip', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    const strip = screen.getByRole('group', { name: '调整选项' });
    for (const label of ['曝光', '饱和度', '锐化']) {
      expect(strip).toContainElement(screen.getByRole('button', { name: label }));
    }
    fireEvent.click(screen.getByRole('button', { name: '锐化' }));
    expect(screen.getByRole('slider', { name: '锐化' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '细节' })).toHaveAttribute('aria-pressed', 'true');
    expect(strip).toContainElement(screen.getByRole('button', { name: '曝光' }));
    fireEvent.click(screen.getByRole('button', { name: '饱和度' }));
    expect(screen.getByRole('slider', { name: '饱和度' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '色彩' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('follows manual horizontal scrolling without changing the active adjustment', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    const strip = screen.getByRole('group', { name: '调整选项' });
    Object.defineProperties(strip, { scrollWidth: { value: 2200 }, clientWidth: { value: 600 } });
    for (const option of PHOTO_ADJUSTMENTS.filter((item) =>
      ['tone', 'color', 'detail'].includes(item.group),
    )) {
      vi.spyOn(
        screen.getByRole('button', { name: option.label }),
        'getBoundingClientRect',
      ).mockReturnValue({
        left: option.group === 'tone' ? -100 : 20,
        right: option.group === 'tone' ? -10 : 90,
      } as DOMRect);
    }
    // Programmatic category navigation must not fight its own smooth scroll.
    fireEvent.scroll(strip);
    expect(screen.getByRole('button', { name: '影调' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerDown(strip, { pointerType: 'touch' });
    fireEvent.scroll(strip);
    expect(screen.getByRole('button', { name: '色彩' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled();
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
  it('edits HSL, curves and grading with shared undo, reset and comparison', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'HSL' }));
    fireEvent.click(screen.getByRole('button', { name: '蓝色' }));
    expect(screen.getAllByRole('slider')).toHaveLength(3);
    const hsl = screen.getByRole('slider', { name: '蓝色 · 饱和度' });
    fireEvent.change(hsl, { target: { value: '-50' } });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(hsl).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(hsl).toHaveValue('-50');
    fireEvent.click(screen.getByRole('button', { name: '曲线' }));
    fireEvent.click(screen.getByRole('button', { name: '主曲线' }));
    fireEvent.click(screen.getByRole('button', { name: '中间调' }));
    fireEvent.change(screen.getByRole('slider', { name: '主曲线 · 中间调' }), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByRole('button', { name: '色彩分级' }));
    fireEvent.click(screen.getByRole('button', { name: '阴影' }));
    expect(screen.getAllByRole('slider')).toHaveLength(3);
    fireEvent.change(screen.getByRole('slider', { name: '阴影 · 饱和度' }), {
      target: { value: '40' },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存到相册' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '对比原图' }));
    await waitFor(() =>
      expect(vi.mocked(composePhoto).mock.calls.at(-1)![2]).toMatchObject({
        hslBlueSaturation: 0,
        curveMaster2: 0,
        gradeShadowsSaturation: 0,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '返回编辑' }));
    await waitFor(() =>
      expect(vi.mocked(composePhoto).mock.calls.at(-1)![2]).toMatchObject({
        hslBlueSaturation: -50,
        curveMaster2: 15,
        gradeShadowsSaturation: 40,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '重置全部' }));
    expect(screen.getByRole('slider', { name: '阴影 · 饱和度' })).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: 'HSL' }));
    expect(screen.getByRole('slider', { name: '蓝色 · 饱和度' })).toHaveValue('0');
  });
  it('shows three direct controls for every HSL color and grading zone and retains independent values', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    for (const [category, families] of [
      ['HSL', ['红色', '橙色', '黄色', '绿色', '青色', '蓝色', '紫色', '洋红']],
      ['色彩分级', ['阴影', '中间调', '高光']],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: category }));
      for (const family of families) {
        fireEvent.click(screen.getByRole('button', { name: family }));
        expect(screen.getAllByRole('slider')).toHaveLength(3);
        expect(screen.queryByRole('group', { name: '调整维度' })).not.toBeInTheDocument();
        for (const [index, axis] of ['色相', '饱和度', '明度'].entries()) {
          const label = `${family} · ${axis}`;
          fireEvent.change(screen.getByRole('slider', { name: label }), {
            target: { value: String((index + 1) * 10) },
          });
          expect(screen.getByRole('spinbutton', { name: `${label}数值` })).toHaveValue(
            (index + 1) * 10,
          );
        }
      }
      fireEvent.click(screen.getByRole('button', { name: families[0] }));
      for (const [index, axis] of ['色相', '饱和度', '明度'].entries()) {
        expect(screen.getByRole('slider', { name: `${families[0]} · ${axis}` })).toHaveValue(
          String((index + 1) * 10),
        );
      }
      fireEvent.doubleClick(screen.getByRole('slider', { name: `${families[0]} · 色相` }));
      expect(screen.getByRole('slider', { name: `${families[0]} · 色相` })).toHaveValue('0');
      expect(screen.getByRole('slider', { name: `${families[0]} · 饱和度` })).toHaveValue('20');
    }
    fireEvent.click(screen.getByRole('button', { name: '平衡' }));
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    expect(screen.getByRole('slider', { name: '分级平衡' })).toBeEnabled();
  });
  it('records a complete curve drag as one undo step and ignores other pointers', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '曲线' }));
    const graph = screen.getByRole('img', { name: '曲线编辑' });
    vi.spyOn(graph, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 256,
      height: 100,
      right: 256,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(graph, 'setPointerCapture', { value: vi.fn() });
    const pointer = (type: string, y: number, id = 1) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: 128, clientY: y, button: 0 });
      Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
      fireEvent(graph, event);
    };
    pointer('pointerdown', 50);
    pointer('pointermove', 30);
    pointer('pointerup', 30, 2);
    pointer('pointermove', 20);
    pointer('pointerup', 20);
    expect(screen.getByRole('slider', { name: '主曲线 · 中间调' })).toHaveValue('30');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('slider', { name: '主曲线 · 中间调' })).toHaveValue('0');
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('slider', { name: '主曲线 · 中间调' })).toHaveValue('30');
  });
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
  it('compares only filters and adjustments while preserving framing, watermark and history', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.change(screen.getByRole('slider', { name: '曝光' }), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: '滤镜' }));
    fireEvent.click(screen.getByRole('button', { name: '复古' }));
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    fireEvent.click(screen.getByRole('button', { name: '1:1' }));
    fireEvent.click(screen.getByRole('button', { name: '旋转' }));
    fireEvent.click(screen.getByRole('button', { name: '镜像' }));
    fireEvent.click(screen.getByRole('button', { name: '水印' }));
    fireEvent.click(screen.getByRole('button', { name: '摄影信息条' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存到相册' })).toBeEnabled());
    const edited = vi.mocked(composePhoto).mock.calls.at(-1)![2];
    const dimensions = screen.getByText(/^[0-9]+ × [0-9]+$/).textContent;
    fireEvent.click(screen.getByRole('button', { name: '对比原图' }));
    await waitFor(() =>
      expect(vi.mocked(composePhoto).mock.calls.at(-1)![2]).toEqual({
        ...edited,
        ...Object.fromEntries(PHOTO_ADJUSTMENTS.map(({ key }) => [key, DEFAULT_PHOTO_EDITS[key]])),
        filter: 'original',
        filterStrength: 100,
      }),
    );
    expect(screen.getByText(/^[0-9]+ × [0-9]+$/)).toHaveTextContent(dimensions!);
    fireEvent.click(screen.getByRole('button', { name: '返回编辑' }));
    await waitFor(() => expect(vi.mocked(composePhoto).mock.calls.at(-1)![2]).toEqual(edited));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('button', { name: '无水印' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    fireEvent.click(screen.getByRole('button', { name: '对比原图' }));
    expect(screen.getByRole('group', { name: '裁剪取景区域' })).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(composePhoto).mock.calls.at(-1)![4]).toBe(false));
  });
  it('edits watermark text as one undoable operation and can remove the frame', async () => {
    render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '水印' }));
    fireEvent.click(screen.getByRole('button', { name: '摄影信息条' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
    fireEvent.change(screen.getByRole('textbox', { name: '显示机型' }), {
      target: { value: 'My photo' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '网站地址' }), {
      target: { value: 'PHOTO.EXAMPLE.COM' },
    });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(screen.queryByRole('dialog', { name: '水印设置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
    expect(screen.getByRole('textbox', { name: '显示机型' })).toHaveValue('Nikon D80');
    expect(screen.getByRole('textbox', { name: '网站地址' })).toHaveValue('WWW.SEKER.WANG');
    fireEvent.keyDown(screen.getByRole('textbox', { name: '显示机型' }), { key: 'Escape' });
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
    fireEvent.click(screen.getByRole('button', { name: '1:1' }));
    fireEvent.click(screen.getByRole('button', { name: '水印' }));
    fireEvent.click(screen.getByRole('button', { name: '摄影信息条' }));
    fireEvent.click(screen.getByRole('button', { name: '调整' }));
    fireEvent.change(screen.getByRole('slider', { name: '曝光' }), { target: { value: '0.2' } });
    fireEvent.click(screen.getByRole('button', { name: '重置全部' }));
    expect(screen.getByRole('slider', { name: '曝光' })).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    expect(screen.getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'true');
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
    fireEvent.click(screen.getByRole('button', { name: '1:1' }));
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

it('keeps filter strength above its thumbnails in the common tool inspector', async () => {
  render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '滤镜' }));
  const strength = screen.getByRole('slider', { name: '滤镜强度' });
  expect(strength).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '复古' }));
  expect(strength).toBeEnabled();
  const thumbnails = screen.getByRole('group', { name: '照片滤镜' });
  expect(
    strength.compareDocumentPosition(thumbnails) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '对比原图' })).toHaveLength(1);
  fireEvent.change(strength, { target: { value: '45' } });
  fireEvent.click(screen.getByRole('button', { name: '调整' }));
  fireEvent.click(screen.getByRole('button', { name: '滤镜' }));
  expect(screen.getByRole('slider', { name: '滤镜强度' })).toHaveValue('45');
});

it('undoes and redoes the frosted watermark background as one ordinary edit', async () => {
  render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '水印' }));
  fireEvent.click(screen.getByRole('button', { name: '居中留白' }));
  fireEvent.click(screen.getByRole('button', { name: '毛玻璃底' }));
  expect(screen.getByRole('button', { name: '毛玻璃底' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(screen.getByRole('button', { name: '白底' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '重做' }));
  expect(screen.getByRole('button', { name: '毛玻璃底' })).toHaveAttribute('aria-pressed', 'true');
});

it('uses a fixed glass preset without blur or darkness controls', async () => {
  render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '水印' }));
  fireEvent.click(screen.getByRole('button', { name: '居中留白' }));
  fireEvent.click(screen.getByRole('button', { name: '毛玻璃底' }));
  expect(screen.getByRole('button', { name: '毛玻璃底' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});

it('uses managed photo metadata when the editable RAW rendition has no original EXIF', async () => {
  render(
    <PhotoEditor
      source="/raw-edit.webp"
      name="DSC.RAF"
      onClose={vi.fn()}
      onSave={vi.fn()}
      initialMetadata={{
        camera: 'FUJIFILM X-E5',
        parameters: '35mm · f/2',
        capturedAt: '2026.10.20 12:30',
      }}
    />,
  );
  await waitFor(() =>
    expect(vi.mocked(composePhoto).mock.lastCall?.[3]).toEqual({
      camera: 'FUJIFILM X-E5',
      parameters: '35mm · f/2',
      capturedAt: '2026.10.20 12:30',
    }),
  );
});

it('can retry locating a saved copy without uploading the image again', async () => {
  const save = vi.fn().mockResolvedValue({ id: 'copy', name: 'output.png' });
  const locate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['png'], { type: 'image/png' })),
  );
  render(
    <PhotoEditor
      source="/photo.png"
      name="Photo.png"
      onClose={vi.fn()}
      onSave={save}
      onOpenSaved={locate}
    />,
  );
  const button = screen.getByRole('button', { name: '保存到相册' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole('button', { name: '查看已保存照片' }));
  await screen.findByText('定位失败，请重试');
  await waitFor(() => expect(screen.getByRole('button', { name: '查看已保存照片' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '查看已保存照片' }));
  await waitFor(() => expect(locate).toHaveBeenCalledTimes(2));
  expect(locate).toHaveBeenLastCalledWith('copy');
  expect(save).toHaveBeenCalledOnce();
});

it('dismisses the discard confirmation with Escape without closing the editor', async () => {
  const close = vi.fn();
  render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={close} onSave={vi.fn()} />);
  const exposure = screen.getByRole('slider', { name: '曝光' });
  await waitFor(() => expect(exposure).toBeEnabled());
  fireEvent.change(exposure, { target: { value: '20' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
});

it('explains a stale source conflict and blocks retries against the same frozen version', async () => {
  const { ApiError } = await import('../../../lib/api-error');
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['png'])),
  );
  const save = vi.fn().mockRejectedValue(new ApiError('stale source', 409, null));
  render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={save} />);
  const button = screen.getByRole('button', { name: '保存到相册' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('重新打开编辑器'));
  expect(button).toBeDisabled();
});

it('rejects an oversized bordered output before allocating a full-resolution canvas', async () => {
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 7728;
      naturalHeight = 5152;
      onload: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  render(<PhotoEditor source="/large.png" name="large.png" onClose={vi.fn()} onSave={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '保存到相册' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '水印' }));
  fireEvent.click(screen.getByRole('button', { name: '居中留白' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('水印后的图片超过'));
  expect(screen.getByRole('button', { name: '保存到相册' })).toBeDisabled();
});

it('restores initial edits, autosaves a draft and copies the current recipe', async () => {
  const onDraftChange = vi.fn().mockResolvedValue({ saved: true }),
    onCopyEdits = vi.fn();
  render(
    <PhotoEditor
      source="/photo.png"
      name="Photo.png"
      initialEdits={{ ...DEFAULT_PHOTO_EDITS, exposure: 0.24 }}
      onDraftChange={onDraftChange}
      onCopyEdits={onCopyEdits}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  );
  const exposure = screen.getByRole('slider', { name: '曝光' });
  await waitFor(() => expect(exposure).toBeEnabled());
  expect(exposure).toHaveValue('0.24');
  fireEvent.change(exposure, { target: { value: '0.35' } });
  await waitFor(
    () =>
      expect(onDraftChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ version: 1, edits: expect.objectContaining({ exposure: 0.35 }) }),
      ),
    { timeout: 2000 },
  );
  fireEvent.click(screen.getByRole('button', { name: '复制编辑参数' }));
  expect(onCopyEdits).toHaveBeenCalledWith(
    expect.objectContaining({ edits: expect.objectContaining({ exposure: 0.35 }) }),
  );
});

it('does not save or claim autosave until a user changes the restored draft', async () => {
  const onDraftChange = vi.fn().mockResolvedValue(undefined);
  const props = {
    source: '/photo.png',
    name: 'Photo.png',
    onClose: vi.fn(),
    onSave: vi.fn(),
    initialEdits: { ...DEFAULT_PHOTO_EDITS, exposure: 0.24 },
    onDraftChange,
  };
  const view = render(<PhotoEditor {...props} />);
  await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(onDraftChange).not.toHaveBeenCalled();
  expect(screen.queryByText('已自动保存')).not.toBeInTheDocument();
  view.rerender(<PhotoEditor {...props} onDraftChange={(recipe) => onDraftChange(recipe)} />);
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(onDraftChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('slider', { name: '曝光' }), { target: { value: '0.35' } });
  await waitFor(() => expect(screen.getByText('已自动保存')).toBeInTheDocument(), {
    timeout: 2000,
  });
  expect(onDraftChange).toHaveBeenCalledTimes(1);
});

it('persists a return to the initial settings while an earlier autosave is in flight', async () => {
  let completeFirst!: () => void;
  const onDraftChange = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeFirst = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  render(
    <PhotoEditor
      source="/photo.png"
      name="Photo.png"
      onClose={vi.fn()}
      onSave={vi.fn()}
      onDraftChange={onDraftChange}
    />,
  );
  const exposure = screen.getByRole('slider', { name: '曝光' });
  await waitFor(() => expect(exposure).toBeEnabled());
  fireEvent.change(exposure, { target: { value: '0.35' } });
  await waitFor(() => expect(onDraftChange).toHaveBeenCalledTimes(1), { timeout: 2000 });
  fireEvent.change(exposure, { target: { value: '0' } });
  completeFirst();
  await waitFor(() => expect(onDraftChange).toHaveBeenCalledTimes(2), { timeout: 2000 });
  expect(onDraftChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ edits: expect.objectContaining({ exposure: 0 }) }),
  );
});

it('opens only the small preview, preserves export dimensions and loads the original only when saving', async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      set src(value: string) {
        if (!value) return;
        requests.push(value);
        if (value === '/original.jpg') {
          this.naturalWidth = 6000;
          this.naturalHeight = 4500;
        }
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['png'])),
  );
  vi.mocked(readPhotoMetadata).mockClear();
  vi.mocked(sourceCanvas).mockClear();
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ id: 'saved', name: 'saved.png' });
  render(
    <PhotoEditor
      source="/original.jpg"
      previewSource="/preview.webp"
      sourceSize={{ width: 6000, height: 4500 }}
      initialMetadata={{ camera: 'Nikon Z5' }}
      name="Photo.jpg"
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  const button = screen.getByRole('button', { name: '保存到相册' });
  await waitFor(() => expect(button).toBeEnabled());
  expect(requests).toEqual(['/preview.webp']);
  expect(readPhotoMetadata).not.toHaveBeenCalled();
  expect(screen.getByText('6000 × 4500')).toBeInTheDocument();
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(requests).toEqual(['/preview.webp', '/original.jpg']);
  expect(vi.mocked(sourceCanvas).mock.calls.at(-1)?.[0].naturalWidth).toBe(6000);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(requests).toEqual(['/preview.webp', '/original.jpg']);
  expect(save.mock.calls[1][0]).toBe(save.mock.calls[0][0]);
});

it('never silently exports a small preview when the original cannot be loaded', async () => {
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        if (value)
          queueMicrotask(() => (value === '/preview.webp' ? this.onload?.() : this.onerror?.()));
      }
    },
  );
  const save = vi.fn();
  render(
    <PhotoEditor
      source="/original.jpg"
      previewSource="/preview.webp"
      sourceSize={{ width: 6000, height: 4500 }}
      name="Photo.jpg"
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  const button = screen.getByRole('button', { name: '保存到相册' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('照片保存失败'));
  expect(save).not.toHaveBeenCalled();
  expect(button).toBeEnabled();
});

it('rejects source dimension changes instead of saving a differently cropped picture', async () => {
  const save = vi.fn();
  render(
    <PhotoEditor
      source="/original.jpg"
      previewSource="/preview.webp"
      sourceSize={{ width: 6000, height: 4500 }}
      name="Photo.jpg"
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  const button = screen.getByRole('button', { name: '保存到相册' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('照片保存失败'));
  expect(save).not.toHaveBeenCalled();
});

it('aborts an original download when its editing scope is destroyed', async () => {
  const images: Array<{ src: string; onload: (() => void) | null }> = [];
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      value = '';
      constructor() {
        images.push(this);
      }
      get src() {
        return this.value;
      }
      set src(value: string) {
        this.value = value;
        if (value === '/preview.webp') queueMicrotask(() => this.onload?.());
      }
    },
  );
  const save = vi.fn();
  const view = render(
    <PhotoEditor
      source="/original.jpg"
      previewSource="/preview.webp"
      sourceSize={{ width: 6000, height: 4500 }}
      name="Photo.jpg"
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  const button = screen.getByRole('button', { name: '保存到相册' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(images).toHaveLength(2));
  view.unmount();
  expect(images[1].src).toBe('');
  expect(images[1].onload).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it('can start Android editing on watermark without changing the web default', () => {
  render(
    <PhotoEditor
      source="/photo.png"
      name="Photo.png"
      initialTab="watermark"
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: '水印' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '调整' }));
  expect(screen.getByRole('button', { name: '调整' })).toHaveAttribute('aria-pressed', 'true');
});

it('offers touch reset without desktop keyboard hints in the phone editor', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(<PhotoEditor source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('slider', { name: '曝光' })).toBeEnabled());
  expect(screen.queryByText('双击归零 · 方向键微调 · Shift 加速')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('slider', { name: '曝光' }), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '重置此项' }));
  expect(screen.getByRole('slider', { name: '曝光' })).toHaveValue('0');
});

it('keeps phone save feedback short without placing a long output filename over the image', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['png'], { type: 'image/png' })),
  );
  const open = vi.fn().mockResolvedValue(undefined);
  render(
    <PhotoEditor
      presentation="native"
      source="/photo.png"
      name="Input.png"
      onClose={vi.fn()}
      onSave={vi
        .fn()
        .mockResolvedValue({ id: 'copy', name: 'output-with-a-very-long-filename.png' })}
      onOpenSaved={open}
    />,
  );
  const save = screen.getByRole('button', { name: '保存到相册' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  fireEvent.click(await screen.findByRole('button', { name: '查看已保存照片' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('copy'));
  expect(screen.queryByText(/output-with-a-very-long-filename/)).not.toBeInTheDocument();
});

it('server recipe saving never loads or exports the original, and preserves full-size crop metadata', async () => {
  const paths: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      set src(value: string) {
        paths.push(value);
        if (value) queueMicrotask(() => this.onload?.());
      }
    },
  );
  const onSaveRecipe = vi.fn().mockResolvedValue({ id: 'server-copy', name: 'copy.png' });
  const onSave = vi.fn();
  render(
    <PhotoEditor
      source="/original-forbidden.jpg"
      previewSource="/thumbnail.webp"
      sourceSize={{ width: 4000, height: 3000 }}
      initialMetadata={{ camera: 'Test Camera' }}
      name="photo.jpg"
      onClose={vi.fn()}
      onSave={onSave}
      onSaveRecipe={onSaveRecipe}
    />,
  );
  const button = screen.getByRole('button', { name: '保存到相册' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(onSaveRecipe).toHaveBeenCalledOnce());
  expect(paths).not.toContain('/original-forbidden.jpg');
  expect(onSave).not.toHaveBeenCalled();
  expect(onSaveRecipe.mock.calls[0][0].edits.watermarkCamera).toBe('Test Camera');
});

 it('limits phone adjustment categories to tone, color and detail', async () => {
  render(<PhotoEditor presentation="native" source="/photo.png" name="Photo.png" onClose={vi.fn()} onSave={vi.fn()} />);
  expect(screen.getByRole('button', { name: '影调' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '色彩' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '细节' })).toBeInTheDocument();
  for (const name of ['HSL', '曲线', '色彩分级']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
 });
