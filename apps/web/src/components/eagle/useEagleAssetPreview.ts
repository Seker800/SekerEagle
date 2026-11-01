import { useCallback, useEffect, useState } from 'react';
import { isCameraVideoMime } from '@sekereagle/library-core';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import {
  useImagePreviewLifecycle,
  type PreviewImage,
} from '../media/image-preview/useImagePreviewState';
import { getEagleLivePhotoContentUrl, getEaglePreviewContentUrl } from './eagle-media-sources';

type PreviewSession = {
  scope: string;
  context: EagleAssetListItem[] | null;
  content: { kind: 'image'; image: PreviewImage } | { kind: 'asset'; assetId: string };
};

/** Images, video and stacks are mutually exclusive presentations of one scoped session. */
export function useEagleAssetPreview(scopeKey: string) {
  const [session, setSession] = useState<PreviewSession | null>(null);
  const current = session?.scope === scopeKey ? session : null;
  const previewImage = current?.content.kind === 'image' ? current.content.image : null;
  const closePreview = useCallback(() => setSession(null), []);
  useImagePreviewLifecycle(previewImage, closePreview);
  useEffect(() => {
    setSession((value) => (value && value.scope !== scopeKey ? null : value));
  }, [scopeKey]);
  const setPreviewImage = useCallback(
    (image: PreviewImage | null) => {
      setSession((value) =>
        image
          ? {
              scope: scopeKey,
              context: value?.scope === scopeKey ? value.context : null,
              content: { kind: 'image', image },
            }
          : null,
      );
    },
    [scopeKey],
  );
  const open = useCallback(
    (asset: EagleAssetListItem, context?: EagleAssetListItem[], stack = false) => {
      if (stack || isCameraVideoMime(asset.mimeType)) {
        setSession({
          scope: scopeKey,
          context: context?.length ? context : null,
          content: { kind: 'asset', assetId: asset.id },
        });
        return 'asset';
      }
      const src = getEaglePreviewContentUrl(asset);
      if (!src) return undefined;
      setSession({
        scope: scopeKey,
        context: context?.length ? context : null,
        content: {
          kind: 'image',
          image: {
            src,
            alt: asset.displayName,
            assetId: asset.id,
            motionSrc: getEagleLivePhotoContentUrl(asset),
          },
        },
      });
      return 'image';
    },
    [scopeKey],
  );
  return {
    previewImage,
    assetId: current?.content.kind === 'asset' ? current.content.assetId : null,
    context: current?.context ?? null,
    closePreview,
    setPreviewImage,
    open,
  };
}
