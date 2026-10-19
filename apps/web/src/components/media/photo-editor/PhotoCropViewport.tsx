import { useEffect, useRef, type PointerEvent } from 'react';
import { t } from '../../../i18n';
import { photoCrop, type PhotoEdits } from './photo-editor-model';
import { dragPhotoCrop, type CropHandle } from './photo-editor-crop-geometry';
import styles from './PhotoEditor.module.css';

export function PhotoCropViewport({
  edits,
  width,
  height,
  disabled,
  onStart,
  onChange,
  onCommit,
}: {
  edits: PhotoEdits;
  width: number;
  height: number;
  disabled: boolean;
  onStart: () => void;
  onChange: (patch: Partial<PhotoEdits>) => void;
  onCommit: () => void;
}) {
  const crop = photoCrop(width, height, edits, false);
  const active = useRef<{
    id: number;
    handle: CropHandle;
    x: number;
    y: number;
    width: number;
    height: number;
    edits: PhotoEdits;
  } | null>(null);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  useEffect(
    () => () => {
      if (active.current) latest.current();
    },
    [],
  );
  function end(event: PointerEvent<HTMLDivElement>) {
    if (active.current?.id !== event.pointerId) return;
    active.current = null;
    onCommit();
  }
  const handles: { id: Exclude<CropHandle, 'move'>; label: string }[] = [
    { id: 'nw', label: t('裁剪左上角') },
    { id: 'n', label: t('裁剪上边') },
    { id: 'ne', label: t('裁剪右上角') },
    { id: 'e', label: t('裁剪右边') },
    { id: 'se', label: t('裁剪右下角') },
    { id: 's', label: t('裁剪下边') },
    { id: 'sw', label: t('裁剪左下角') },
    { id: 'w', label: t('裁剪左边') },
  ];
  return (
    <div
      className={styles.cropFrame}
      style={{
        left: `${(crop.x / crop.orientedWidth) * 100}%`,
        top: `${(crop.y / crop.orientedHeight) * 100}%`,
        width: `${(crop.width / crop.orientedWidth) * 100}%`,
        height: `${(crop.height / crop.orientedHeight) * 100}%`,
      }}
      role="group"
      aria-label={t('裁剪取景区域')}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(event) => {
        if (disabled || active.current || (event.pointerType === 'mouse' && event.button !== 0))
          return;
        const rect = event.currentTarget.parentElement!.getBoundingClientRect();
        const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-crop-handle]')
          ?.dataset.cropHandle as CropHandle | undefined;
        event.preventDefault();
        if (handle) (event.target as HTMLElement).closest<HTMLElement>('button')?.focus();
        else event.currentTarget.focus();
        onStart();
        active.current = {
          id: event.pointerId,
          handle: handle ?? 'move',
          x: event.clientX,
          y: event.clientY,
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
          edits,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = active.current;
        if (!start || start.id !== event.pointerId || disabled) return;
        onChange(
          dragPhotoCrop(
            width,
            height,
            start.edits,
            start.handle,
            ((event.clientX - start.x) / start.width) * crop.orientedWidth,
            ((event.clientY - start.y) / start.height) * crop.orientedHeight,
            {
              width: (32 / start.width) * crop.orientedWidth,
              height: (32 / start.height) * crop.orientedHeight,
            },
          ),
        );
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (disabled) return;
        const step = event.shiftKey ? 20 : 2;
        const keys: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const delta = keys[event.key];
        if (!delta) return;
        event.preventDefault();
        const handle = (event.target as HTMLElement).dataset.cropHandle as CropHandle | undefined;
        onStart();
        onChange(dragPhotoCrop(width, height, edits, handle ?? 'move', ...delta));
        onCommit();
      }}
    >
      <span />
      <span />
      <span />
      <span />
      {handles.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          className={styles.cropHandle}
          data-crop-handle={id}
          aria-label={label}
        />
      ))}
    </div>
  );
}
