import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PhotoCropViewport } from './PhotoCropViewport';
import { DEFAULT_PHOTO_EDITS, photoCrop, type PhotoEdits } from './photo-editor-model';

afterEach(() => {
  vi.restoreAllMocks();
});
function setup(patch: Partial<PhotoEdits> = {}) {
  const edits = { ...DEFAULT_PHOTO_EDITS, ...patch };
  const onStart = vi.fn(),
    onChange = vi.fn<(patch: Partial<PhotoEdits>) => void>(),
    onCommit = vi.fn();
  render(
    <PhotoCropViewport
      edits={edits}
      width={2000}
      height={1200}
      disabled={false}
      onStart={onStart}
      onChange={onChange}
      onCommit={onCommit}
    />,
  );
  const viewport = screen.getByRole('group', { name: '裁剪取景区域' });
  vi.spyOn(viewport.parentElement!, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 240,
    width: 400,
    height: 240,
    toJSON: () => ({}),
  });
  return { viewport, edits, onStart, onChange, onCommit };
}
function pointer(target: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
  fireEvent(target, event);
}
it('resizes a free crop from the outer corner and commits one complete drag', () => {
  const { viewport, edits, onStart, onChange, onCommit } = setup({ cropRatio: 'free' });
  pointer(screen.getByRole('button', { name: '裁剪右下角' }), 'pointerdown', 400, 240);
  pointer(viewport, 'pointermove', 300, 200);
  pointer(viewport, 'pointermove', 280, 180);
  pointer(viewport, 'pointerup', 280, 180);
  const region = photoCrop(2000, 1200, { ...edits, ...onChange.mock.calls[1][0] });
  expect([region.x, region.y, region.width, region.height]).toEqual([0, 0, 1400, 900]);
  expect(onStart).toHaveBeenCalledOnce();
  expect(onCommit).toHaveBeenCalledOnce();
});
it('keeps fixed aspect ratio while resizing a side with the keyboard', () => {
  const { edits, onStart, onChange, onCommit } = setup({ cropRatio: '4:3' });
  fireEvent.keyDown(screen.getByRole('button', { name: '裁剪右边' }), {
    key: 'ArrowLeft',
    shiftKey: true,
  });
  const region = photoCrop(2000, 1200, { ...edits, ...onChange.mock.calls[0][0] });
  expect(region.width).toBe(1580);
  expect(region.height).toBe(1185);
  expect(onStart).toHaveBeenCalledOnce();
  expect(onCommit).toHaveBeenCalledOnce();
});
it('moves the crop rectangle instead of the photo and leaves wheel input unchanged', () => {
  const { viewport, edits, onChange } = setup({ cropZoom: 2 });
  pointer(viewport, 'pointerdown', 100, 100);
  pointer(viewport, 'pointermove', 120, 100);
  pointer(viewport, 'pointerup', 120, 100);
  const region = photoCrop(2000, 1200, { ...edits, ...onChange.mock.calls[0][0] });
  expect(region.x).toBe(600);
  onChange.mockClear();
  expect(fireEvent.wheel(viewport, { deltaY: -100, cancelable: true })).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});
