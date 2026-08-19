import { useCallback, useEffect, useState } from 'react';

export interface PreviewImage {
  src: string;
  alt: string;
  assetId?: string;
}

export function useImagePreviewState() {
  const [previewImage, setPreviewImageInner] = useState<PreviewImage | null>(null);

  const setPreviewImage = useCallback((next: PreviewImage | null) => {
    setPreviewImageInner((current) => {
      if (current?.src.startsWith('blob:') && current.src !== next?.src) {
        URL.revokeObjectURL(current.src);
      }
      return next;
    });
  }, []);

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

  const closePreview = useCallback(() => {
    setPreviewImage(null);
  }, [setPreviewImage]);

  return {
    closePreview,
    previewImage,
    setPreviewImage,
  };
}
