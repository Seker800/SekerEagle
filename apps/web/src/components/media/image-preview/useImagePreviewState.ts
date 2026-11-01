import { useCallback, useEffect, useState } from 'react';

export interface PreviewImage {
  src: string;
  alt: string;
  assetId?: string;
  motionSrc?: string | null;
}

export function useImagePreviewState() {
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const closePreview = useCallback(() => setPreviewImage(null), []);
  useImagePreviewLifecycle(previewImage, closePreview);
  return { closePreview, previewImage, setPreviewImage };
}

/** Shared image resource lifecycle for standalone and library preview owners. */
export function useImagePreviewLifecycle(
  previewImage: PreviewImage | null,
  closePreview: () => void,
) {
  useEffect(
    () => () => {
      if (previewImage?.src.startsWith('blob:')) URL.revokeObjectURL(previewImage.src);
    },
    [previewImage?.src],
  );
  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePreview();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewImage !== null, closePreview]);
}
