import type { PhotoEdits } from './photo-editor-model';
import type { PhotoMetadata } from './photo-watermark-model';
import { composePhoto, sourceCanvas, type createPhotoRenderer } from './photo-editor-render';
import { editedPhotoName } from './photo-editor-save';
export async function renderEditedPhotoFile(
  image: HTMLImageElement,
  edits: PhotoEdits,
  metadata: PhotoMetadata,
  renderer: ReturnType<typeof createPhotoRenderer>,
  name: string,
): Promise<File> {
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
    // Desktop cache images have their own origin. Negotiate the existing narrow
    // CORS policy before loading so preview and export canvases remain readable.
    image.crossOrigin = 'use-credentials';
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
