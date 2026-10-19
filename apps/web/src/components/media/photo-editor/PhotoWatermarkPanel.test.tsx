import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhotoWatermarkPanel } from './PhotoWatermarkPanel';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';
import { WATERMARK_TEMPLATES } from './photo-watermark-model';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(width = 300) {
  const onChange = vi.fn();
  const props = {
    edits: { ...DEFAULT_PHOTO_EDITS },
    metadata: {},
    source: null,
    disabled: false,
    metadataLoading: false,
    onChange,
  };
  const view = render(<PhotoWatermarkPanel {...props} />);
  const row = screen.getByRole('group', { name: '水印模板' });
  Object.defineProperties(row, { clientWidth: { value: width }, scrollWidth: { value: 900 } });
  const rect = (left: number, w: number) => ({
    left,
    top: 0,
    right: left + w,
    bottom: 100,
    width: w,
    height: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rect(0, width));
  within(row)
    .getAllByRole('button')
    .forEach((button, index) => {
      vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() =>
        rect(index * 100 - row.scrollLeft, 90),
      );
    });
  const scrollTo = vi.fn(({ left }: { left: number }) => {
    row.scrollLeft = Math.max(0, Math.min(900 - width, left));
    fireEvent.scroll(row);
  });
  Object.defineProperty(row, 'scrollTo', { value: scrollTo });
  return { onChange, row, scrollTo, view, props };
}

it('keeps every watermark layout in one row when navigating categories without editing the photo', () => {
  const { onChange, row, scrollTo } = setup();
  expect(within(row).getAllByRole('button')).toHaveLength(WATERMARK_TEMPLATES.length + 1);
  for (const template of WATERMARK_TEMPLATES)
    expect(within(row).getByRole('button', { name: template.label })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '适合竖图' }));
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 400, behavior: 'smooth' });
  expect(screen.getByRole('button', { name: '适合竖图' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(row).getByRole('button', { name: '摄影信息条' })).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: '居中留白' })).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: '无水印' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps the requested category active when its scroll target is clamped on a wide viewport', () => {
  const { row, onChange } = setup(650);
  fireEvent.click(screen.getByRole('button', { name: '横竖通用' }));
  expect(row.scrollLeft).toBe(250);
  expect(screen.getByRole('button', { name: '横竖通用' })).toHaveAttribute('aria-pressed', 'true');
  expect(onChange).not.toHaveBeenCalled();
});

it('follows manual scrolling across categories and includes the final category at the end', () => {
  const { row, onChange } = setup(200);
  fireEvent.wheel(row, { deltaY: 1 });
  row.scrollLeft = 400;
  fireEvent.scroll(row);
  expect(screen.getByRole('button', { name: '适合竖图' })).toHaveAttribute('aria-pressed', 'true');
  row.scrollLeft = 600;
  fireEvent.scroll(row);
  expect(screen.getByRole('button', { name: '横竖通用' })).toHaveAttribute('aria-pressed', 'true');
  row.scrollLeft = 700;
  fireEvent.scroll(row);
  expect(screen.getByRole('button', { name: '横竖通用' })).toHaveAttribute('aria-pressed', 'true');
  expect(onChange).not.toHaveBeenCalled();
});

it('selects layouts across categories and reveals the selected category on undo or redo', () => {
  const { onChange, row, view, props } = setup();
  const frame = within(row).getByRole('button', { name: '居中留白' });
  fireEvent.click(frame);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ watermark: 'frame-minimal' }));
  view.rerender(
    <PhotoWatermarkPanel {...props} edits={{ ...props.edits, watermark: 'frame-poster' }} />,
  );
  expect(screen.getByRole('button', { name: '横竖通用' })).toHaveAttribute('aria-pressed', 'true');
  view.rerender(<PhotoWatermarkPanel {...props} />);
  expect(within(row).getByRole('button', { name: '无水印' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: '适合横图' })).toHaveAttribute('aria-pressed', 'true');
});

it('merges signature alignment into controls instead of separate layouts', () => {
  const { props, view, onChange, row } = setup();
  view.rerender(
    <PhotoWatermarkPanel {...props} edits={{ ...props.edits, watermark: 'standard-right' }} />,
  );
  expect(screen.getByRole('button', { name: '右对齐' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(row).getByRole('button', { name: '平面签名' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '左对齐' }));
  expect(onChange).toHaveBeenCalledWith({ watermark: 'standard-left', watermarkAlign: 'left' });
});

it('lets every watermark toggle a website and edit its text without applying a cancelled draft', () => {
  const { props, view, onChange } = setup();
  for (const template of WATERMARK_TEMPLATES) {
    view.rerender(
      <PhotoWatermarkPanel {...props} edits={{ ...props.edits, watermark: template.id }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '网站地址' }));
    expect(onChange).toHaveBeenLastCalledWith({ watermarkShowWebsite: false });
  }
  fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
  const input = screen.getByRole('textbox', { name: '网站地址' });
  expect(input).toHaveValue('WWW.SEKER.WANG');
  fireEvent.change(input, { target: { value: 'PHOTO.EXAMPLE.COM' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(onChange).not.toHaveBeenCalledWith(
    expect.objectContaining({ watermarkWebsite: 'PHOTO.EXAMPLE.COM' }),
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
  expect(screen.getByRole('textbox', { name: '网站地址' })).toHaveValue('WWW.SEKER.WANG');
  fireEvent.change(screen.getByRole('textbox', { name: '网站地址' }), {
    target: { value: 'PHOTO.EXAMPLE.COM' },
  });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ watermarkWebsite: 'PHOTO.EXAMPLE.COM' }),
  );
});

it('prefills detected metadata for editing and allows blank overrides or manual entries', () => {
  const { props, view, onChange } = setup();
  view.rerender(
    <PhotoWatermarkPanel
      {...props}
      edits={{ ...props.edits, watermark: 'photo-strip' }}
      metadata={{
        camera: 'FUJIFILM X-E5',
        parameters: '35mm · f/2.8',
        capturedAt: '2026.10.19 10:30',
      }}
    />,
  );
  expect(screen.getByRole('button', { name: '拍摄时间' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
  expect(screen.getByRole('textbox', { name: '显示机型' })).toHaveValue('FUJIFILM X-E5');
  expect(screen.getByRole('textbox', { name: '拍摄参数' })).toHaveValue('35mm · f/2.8');
  expect(screen.getByRole('textbox', { name: '拍摄时间' })).toHaveValue('2026.10.19 10:30');
  for (const name of ['显示机型', '拍摄参数', '拍摄时间'])
    fireEvent.change(screen.getByRole('textbox', { name }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      watermarkCamera: '',
      watermarkParameters: '',
      watermarkCapturedAt: '',
    }),
  );
  view.rerender(
    <PhotoWatermarkPanel {...props} edits={{ ...props.edits, watermark: 'photo-strip' }} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
  expect(screen.getByRole('textbox', { name: '显示机型' })).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox', { name: '显示机型' }), {
    target: { value: 'Nikon Z5' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: '拍摄时间' }), {
    target: { value: '2026.10.18' },
  });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ watermarkCamera: 'Nikon Z5', watermarkCapturedAt: '2026.10.18' }),
  );
});


it('keeps untouched fields automatic when metadata arrives while the text editor is open', () => {
  const { props, view, onChange } = setup();
  const edits = { ...props.edits, watermark: 'photo-strip' };
  view.rerender(<PhotoWatermarkPanel {...props} edits={edits} metadataLoading />);
  fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
  expect(screen.getByRole('textbox', { name: '显示机型' })).toHaveValue('');
  view.rerender(<PhotoWatermarkPanel {...props} edits={edits} metadata={{ camera: 'NIKON D80', parameters: '135mm · f/5.6', capturedAt: '2010.07.31' }} />);
  expect(screen.getByRole('textbox', { name: '显示机型' })).toHaveValue('NIKON D80');
  expect(screen.getByRole('textbox', { name: '拍摄参数' })).toHaveValue('135mm · f/5.6');
  fireEvent.change(screen.getByRole('textbox', { name: '签名文字' }), { target: { value: 'Signature' } });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ watermarkText: 'Signature', watermarkCamera: null, watermarkParameters: null, watermarkCapturedAt: null }));
});

it('can restore detected information after an empty or custom override without clearing the signature or website', () => {
  const { props, view, onChange } = setup();
  view.rerender(<PhotoWatermarkPanel {...props} edits={{ ...props.edits, watermark: 'color-block', watermarkText: 'Signature', watermarkCamera: '', watermarkWebsite: 'WWW.SEKER.WANG' }} metadata={{ camera: 'NIKON D80' }} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑水印文字' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复照片信息' }));
  expect(screen.getByRole('textbox', { name: '显示机型' })).toHaveValue('NIKON D80');
  expect(screen.getByRole('textbox', { name: '签名文字' })).toHaveValue('Signature');
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ watermarkCamera: null, watermarkText: 'Signature', watermarkWebsite: 'WWW.SEKER.WANG' }));
});
