import { loadPhotoLut } from './photo-lut-storage';
import type { PhotoLut } from './photo-lut';
import { photoCrop, type PhotoEdits } from './photo-editor-model';
import { renderPhotoWatermark } from './photo-editor-watermark';
import type { PhotoMetadata } from './photo-watermark-model';

export const MAX_PHOTO_PIXELS = 48_000_000;
export function sourceCanvas(image: HTMLImageElement, maxEdge?: number): HTMLCanvasElement {
  const scale = maxEdge
    ? Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
    : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function drawPhoto(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  edits: PhotoEdits,
  crop = true,
) {
  const region = photoCrop(source.width, source.height, edits);
  target.width = crop ? region.width : region.orientedWidth;
  target.height = crop ? region.height : region.orientedHeight;
  const context = target.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.save();
  context.translate(
    (crop ? -region.x : 0) + region.orientedWidth / 2,
    (crop ? -region.y : 0) + region.orientedHeight / 2,
  );
  if (edits.flip) context.scale(-1, 1);
  context.rotate((edits.rotation * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  context.restore();
}

interface WorkerResult {
  id: number;
  pixels?: Uint8Array;
  error?: boolean;
}

export function composePhoto(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  edits: PhotoEdits,
  metadata: PhotoMetadata = {},
  crop = true,
) {
  if (!crop || edits.watermark === 'none') {
    drawPhoto(target, source, edits, crop);
    return;
  }
  const photo = document.createElement('canvas');
  drawPhoto(photo, source, edits);
  const composed = renderPhotoWatermark(photo, edits, metadata);
  target.width = composed.width;
  target.height = composed.height;
  const context = target.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.drawImage(composed, 0, 0);
}
export function createPhotoRenderer() {
  const worker = new Worker(new URL('./photo-editor.worker.ts', import.meta.url), {
    type: 'module',
  });
  let sequence = 0;
  let personalLut: { id: string; table: Promise<PhotoLut> } | null = null;
  interface Job {
    id: number;
    source: HTMLCanvasElement;
    edits: PhotoEdits;
    key: string;
    resolve: (canvas: HTMLCanvasElement) => void;
    reject: (reason: Error) => void;
  }
  let active: Job | null = null,
    queued: Job | null = null;
  let stopped = false;
  let cached: { source: HTMLCanvasElement; key: string; result: HTMLCanvasElement } | null = null;
  function next() {
    if (active || !queued || stopped) return;
    const job = queued;
    queued = null;
    active = job;
    const rejectJob = (error: unknown) => {
      if (active !== job) return;
      active = null;
      job.reject(error instanceof Error ? error : new Error('PHOTO_RENDER_FAILED'));
      next();
    };
    const send = (lut?: PhotoLut) => {
      if (stopped || active !== job) return;
      try {
        const context = job.source.getContext('2d');
        if (!context) throw new Error('CANVAS_UNAVAILABLE');
        const pixels = context.getImageData(0, 0, job.source.width, job.source.height).data;
        worker.postMessage(
          {
            id: job.id,
            pixels: new Uint8Array(pixels.buffer),
            width: job.source.width,
            height: job.source.height,
            edits: job.edits,
            lut,
          },
          [pixels.buffer],
        );
      } catch (error) {
        rejectJob(error);
      }
    };
    if (job.edits.filter.startsWith('lut:') && job.edits.filterStrength > 0) {
      const id = job.edits.filter.slice(4);
      if (personalLut?.id !== id) personalLut = { id, table: loadPhotoLut(id) };
      void personalLut.table.then(send).catch((error: unknown) => {
        if (personalLut?.id === id) personalLut = null;
        rejectJob(error);
      });
    } else send();
  }

  const fail = () => {
    stopped = true;
    active?.reject(new Error('PHOTO_RENDER_FAILED'));
    queued?.reject(new Error('PHOTO_RENDER_FAILED'));
    active = null;
    queued = null;
    cached = null;
    personalLut = null;
  };
  worker.onerror = fail;
  worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
    const request = active;
    if (!request || request.id !== data.id) return;
    active = null;
    try {
      if (data.error || !data.pixels) throw new Error('PHOTO_RENDER_FAILED');
      const canvas = document.createElement('canvas');
      canvas.width = request.source.width;
      canvas.height = request.source.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('CANVAS_UNAVAILABLE');
      context.putImageData(
        new ImageData(new Uint8ClampedArray(data.pixels), canvas.width, canvas.height),
        0,
        0,
      );
      if (canvas.width * canvas.height <= 2_000_000)
        cached = { source: request.source, key: request.key, result: canvas };
      request.resolve(canvas);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error('PHOTO_RENDER_FAILED'));
    } finally {
      next();
    }
  };
  return {
    render(source: HTMLCanvasElement, edits: PhotoEdits): Promise<HTMLCanvasElement> {
      if (stopped) return Promise.reject(new Error('PHOTO_RENDER_FAILED'));
      const key = JSON.stringify(
        Object.entries(edits).filter(
          ([key]) =>
            !key.startsWith('watermark') &&
            !(
              !edits.grain &&
              !edits.vignette &&
              [
                'cropRatio',
                'cropZoom',
                'cropAspect',
                'cropX',
                'cropY',
                'rotation',
                'flip',
              ].includes(key)
            ),
        ),
      );
      if (cached?.source === source && cached.key === key) return Promise.resolve(cached.result);
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        // One running frame and one latest pending frame; never queue a whole drag gesture.
        queued?.reject(new DOMException('Superseded photo preview', 'AbortError'));
        queued = { id, source, edits, key, resolve, reject };
        next();
      });
    },
    dispose() {
      worker.terminate();
      fail();
    },
  };
}
