import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const PREVIEW_DRAG_THRESHOLD_PX = 6;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const SCALE_STEP = 0.25;

export interface PreviewImage {
  src: string;
  alt: string;
}

interface Dimensions {
  width: number;
  height: number;
}

function clampScale(scale: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

export function useImagePreviewState() {
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const previewPointerStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originOffsetX: number;
    originOffsetY: number;
    moved: boolean;
  } | null>(null);
  const [previewImage, setPreviewImageInner] = useState<PreviewImage | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [previewNaturalSize, setPreviewNaturalSize] = useState<Dimensions>({ width: 0, height: 0 });
  const [previewStageSize, setPreviewStageSize] = useState<Dimensions>({ width: 0, height: 0 });

  const resetPreviewSessionState = useCallback(() => {
    previewPointerStateRef.current = null;
    setPreviewScale(1);
    setPreviewOffset({ x: 0, y: 0 });
    setPreviewNaturalSize({ width: 0, height: 0 });
  }, []);

  const setPreviewImage = useCallback(
    (next: PreviewImage | null) => {
      resetPreviewSessionState();
      setPreviewImageInner((current) => {
        if (current?.src.startsWith('blob:') && current.src !== next?.src) {
          URL.revokeObjectURL(current.src);
        }
        return next;
      });
    },
    [resetPreviewSessionState],
  );

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewImage, setPreviewImage]);

  useLayoutEffect(() => {
    if (!previewImage) {
      return;
    }

    const stage = previewStageRef.current;
    if (!stage) {
      return;
    }

    const syncStageSize = () => {
      const bounds = stage.getBoundingClientRect();
      setPreviewStageSize({
        width: Math.max(bounds.width, 0),
        height: Math.max(bounds.height, 0),
      });
    };

    syncStageSize();

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            syncStageSize();
          });

    resizeObserver?.observe(stage);
    window.addEventListener('resize', syncStageSize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncStageSize);
    };
  }, [previewImage]);

  const fitScale = useMemo(() => {
    if (
      !previewNaturalSize.width ||
      !previewNaturalSize.height ||
      !previewStageSize.width ||
      !previewStageSize.height
    ) {
      return 1;
    }

    return Math.min(
      previewStageSize.width / previewNaturalSize.width,
      previewStageSize.height / previewNaturalSize.height,
      1,
    );
  }, [
    previewNaturalSize.height,
    previewNaturalSize.width,
    previewStageSize.height,
    previewStageSize.width,
  ]);

  useEffect(() => {
    if (
      !previewImage ||
      !previewNaturalSize.width ||
      !previewNaturalSize.height ||
      !previewStageSize.width ||
      !previewStageSize.height
    ) {
      return;
    }

    setPreviewScale(fitScale);
    setPreviewOffset({ x: 0, y: 0 });
  }, [
    fitScale,
    previewImage,
    previewNaturalSize.height,
    previewNaturalSize.width,
    previewStageSize.height,
    previewStageSize.width,
  ]);

  const renderedDimensions = useMemo(() => {
    if (!previewNaturalSize.width || !previewNaturalSize.height) {
      return null;
    }

    return {
      width: previewNaturalSize.width * previewScale,
      height: previewNaturalSize.height * previewScale,
    };
  }, [previewNaturalSize.height, previewNaturalSize.width, previewScale]);

  const activeDimensions = useMemo(() => {
    if (!renderedDimensions) {
      return null;
    }

    return {
      width: Math.max(Math.round(renderedDimensions.width), 1),
      height: Math.max(Math.round(renderedDimensions.height), 1),
    };
  }, [renderedDimensions]);

  const canPan = Boolean(
    previewImage && renderedDimensions && previewStageSize.width && previewStageSize.height,
  );

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const handleWindowPointerMove = (event: PointerEvent) => {
      const pointerState = previewPointerStateRef.current;
      if (!pointerState || pointerState.pointerId !== event.pointerId || !canPan) {
        return;
      }

      const nextOffset = {
        x: pointerState.originOffsetX + (event.clientX - pointerState.startX),
        y: pointerState.originOffsetY + (event.clientY - pointerState.startY),
      };
      const movedDistance = Math.max(
        Math.abs(event.clientX - pointerState.startX),
        Math.abs(event.clientY - pointerState.startY),
      );

      if (movedDistance >= PREVIEW_DRAG_THRESHOLD_PX) {
        pointerState.moved = true;
      }

      setPreviewOffset(nextOffset);
    };

    const handleWindowPointerEnd = (event: PointerEvent) => {
      const pointerState = previewPointerStateRef.current;
      if (!pointerState || pointerState.pointerId !== event.pointerId) {
        return;
      }

      previewPointerStateRef.current = null;
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
    };
  }, [canPan, previewImage]);

  const closePreview = useCallback(() => {
    setPreviewImage(null);
  }, [setPreviewImage]);

  const handlePreviewPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!canPan) {
        return;
      }

      previewPointerStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originOffsetX: previewOffset.x,
        originOffsetY: previewOffset.y,
        moved: false,
      };
    },
    [canPan, previewOffset.x, previewOffset.y],
  );

  const handlePreviewWheel = useCallback(
    (event: WheelEvent) => {
      if (!previewNaturalSize.width || !previewNaturalSize.height) {
        return;
      }

      event.preventDefault();

      const delta = event.deltaY > 0 ? -SCALE_STEP : SCALE_STEP;
      const nextScale = clampScale(previewScale + delta);
      if (nextScale === previewScale) {
        return;
      }

      const stage = previewStageRef.current;
      if (!stage) {
        return;
      }

      const rect = stage.getBoundingClientRect();
      const cursorX = event.clientX - rect.left - rect.width / 2;
      const cursorY = event.clientY - rect.top - rect.height / 2;
      const imageX = (cursorX - previewOffset.x) / previewScale;
      const imageY = (cursorY - previewOffset.y) / previewScale;

      setPreviewScale(nextScale);
      setPreviewOffset({
        x: cursorX - imageX * nextScale,
        y: cursorY - imageY * nextScale,
      });
    },
    [
      previewNaturalSize.height,
      previewNaturalSize.width,
      previewOffset.x,
      previewOffset.y,
      previewScale,
    ],
  );

  return {
    activeDimensions,
    canPan,
    closePreview,
    fitScale,
    handlePreviewPointerDown,
    handlePreviewWheel,
    previewImage,
    previewOffset,
    previewScale,
    previewStageRef,
    setPreviewImage,
    setPreviewNaturalSize,
  };
}
