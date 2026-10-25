import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createCanvas, ImageData, type Canvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { initSync } from '@silvia-odwyer/photon/photon_rs.js';
import { readPhotoEditRecipe, type PhotoEdits } from '@sekereagle/library-core';
import { processPhotoPixels } from './photo-editor-photon';
import { drawPhoto } from './photo-editor-geometry';
import { renderPhotoWatermark } from './photo-editor-watermark';
import { MAX_PHOTO_PIXELS, withinPhotoOutputBudget } from './photo-editor-limits';
import type { PhotoMetadata } from './photo-watermark-model';
import type { PhotoLut } from './photo-lut';
let ready = false;
/** Same pixel, crop and watermark code as the phone preview; source bytes stay on the server. */
async function renderServerPhotoLocal(
  source: Buffer,
  input: PhotoEdits,
  metadata: PhotoMetadata,
  lut?: PhotoLut,
): Promise<Buffer> {
  const edits = readPhotoEditRecipe({ version: 1, edits: input }).edits;
  if (!ready) {
    initSync({ module: readFileSync(require.resolve('@silvia-odwyer/photon/photon_rs_bg.wasm')) });
    ready = true;
  }
  const { data, info } = await sharp(source, { limitInputPixels: MAX_PHOTO_PIXELS })
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!withinPhotoOutputBudget(info.width, info.height)) throw new Error('PHOTO_SOURCE_TOO_LARGE');
  const pixels = processPhotoPixels(new Uint8Array(data), info.width, info.height, edits, lut);
  const canvas = createCanvas(info.width, info.height);
  canvas
    .getContext('2d')
    .putImageData(new ImageData(new Uint8ClampedArray(pixels), info.width, info.height), 0, 0);
  const create = () => createCanvas(1, 1) as unknown as HTMLCanvasElement;
  const cropped = create();
  drawPhoto(cropped, canvas as unknown as HTMLCanvasElement, edits);
  const output = renderPhotoWatermark(cropped, edits, metadata, create);
  if (!withinPhotoOutputBudget(output.width, output.height))
    throw new Error('PHOTO_OUTPUT_TOO_LARGE');
  return (output as unknown as Canvas).toBuffer('image/png');
}

/** Keep CPU-bound pixels off the lease/heartbeat event loop. One worker per bounded NAS slot. */
export async function renderServerPhoto(
  source: Buffer,
  input: PhotoEdits,
  metadata: PhotoMetadata,
  lut?: PhotoLut,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { photoRender: true, source, input, metadata, lut },
    });
    let finished = false;
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('PHOTO_RENDER_TIMEOUT'));
    }, 300000);
    worker.once('message', (reply: { output?: Uint8Array; error?: string }) => {
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (reply.output) resolve(Buffer.from(reply.output));
      else reject(new Error(reply.error || 'PHOTO_RENDER_FAILED'));
    });
    worker.once('error', (reason) => {
      clearTimeout(timer);
      reject(reason);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (!finished) reject(new Error(`PHOTO_RENDER_WORKER_EXIT:${code}`));
    });
  });
}
const task = workerData as
  | {
      photoRender?: boolean;
      source: Uint8Array;
      input: PhotoEdits;
      metadata: PhotoMetadata;
      lut?: PhotoLut;
    }
  | undefined;
if (!isMainThread && task?.photoRender) {
  void renderServerPhotoLocal(Buffer.from(task.source), task.input, task.metadata, task.lut).then(
    (output) => parentPort?.postMessage({ output }),
    (reason: unknown) =>
      parentPort?.postMessage({
        error: reason instanceof Error ? reason.message : 'PHOTO_RENDER_FAILED',
      }),
  );
}
