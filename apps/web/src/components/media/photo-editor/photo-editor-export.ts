import { photoCrop, type PhotoEdits } from './photo-editor-model';
import { MAX_PHOTO_PIXELS, withinPhotoOutputBudget } from './photo-editor-limits';
import { findWatermark, photoWatermarkLayout, type PhotoMetadata } from './photo-watermark-model';
import { composePhoto, sourceCanvas, type createPhotoRenderer } from './photo-editor-render';
import { editedPhotoName } from './photo-editor-save';
export async function renderEditedPhotoFile(
  image: HTMLImageElement,
  edits: PhotoEdits,
  metadata: PhotoMetadata,
  renderer: ReturnType<typeof createPhotoRenderer>,
  name: string,
): Promise<File> {
  if (image.naturalWidth * image.naturalHeight > MAX_PHOTO_PIXELS)
    throw new Error('PHOTO_PIXEL_LIMIT');
  const crop = photoCrop(image.naturalWidth, image.naturalHeight, edits),
    template = findWatermark(edits.watermark);
  const size = template ? photoWatermarkLayout(crop.width, crop.height, template) : crop;
  if (!withinPhotoOutputBudget(size.width, size.height)) throw new Error('PHOTO_OUTPUT_LIMIT');
  const input = sourceCanvas(image);
  try {
    const result = await renderer.render(input, edits),
      output = document.createElement('canvas');
    try {
      composePhoto(output, result, edits, metadata);
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('ENCODE_FAILED'))),
          'image/png',
        ),
      );
      return new File([blob], editedPhotoName(name), { type: 'image/png' });
    } finally {
      result.width = result.height = 1;
      output.width = output.height = 1;
    }
  } finally {
    input.width = input.height = 1;
  }
}
export function loadEditablePhoto(source: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      image.src = '';
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('PHOTO_LOAD_FAILED'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    image.src = source;
  });
}
