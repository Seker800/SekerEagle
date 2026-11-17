import type { PhotoEdits } from './photo-editor-model';
import type { PhotoMetadata } from './photo-watermark-model';
import { composePhoto, sourceCanvas, type createPhotoRenderer } from './photo-editor-render';
import { editedPhotoName } from './photo-editor-save';

/** Match the source container so a photo is not inflated into a full-size PNG. */
export function photoExportEncoding(sourceMimeType?: string): {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  quality?: number;
} {
  if (sourceMimeType === 'image/png') return { mimeType: 'image/png' };
  if (sourceMimeType === 'image/webp') return { mimeType: 'image/webp', quality: 0.92 };
  return { mimeType: 'image/jpeg', quality: 0.92 };
}

function exportExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

export async function renderEditedPhotoFile(
  image: HTMLImageElement,
  edits: PhotoEdits,
  metadata: PhotoMetadata,
  renderer: ReturnType<typeof createPhotoRenderer>,
  name: string,
  sourceMimeType?: string,
): Promise<File> {
  const input = sourceCanvas(image);
  try {
    const result = await renderer.render(input, edits),
      output = document.createElement('canvas');
    try {
      composePhoto(output, result, edits, metadata);
      const target = photoExportEncoding(sourceMimeType);
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('ENCODE_FAILED'))),
          target.mimeType,
          target.quality,
        ),
      );
      // Browsers fall back to PNG when they cannot encode the requested type.
      return new File([blob], editedPhotoName(name, exportExtension(blob.type)), {
        type: blob.type,
      });
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
