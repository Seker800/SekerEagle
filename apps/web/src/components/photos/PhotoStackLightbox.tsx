import { IconStar, IconStarFilled, IconLayersSubtract } from '@tabler/icons-react';
import { PhotoStackFilmstrip, stackAssetKey } from './PhotoStackFilmstrip';
import { needsEagleImagePyramid } from '../eagle/eagle-media-sources';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import type { EaglePhotoStack, EagleAssetListItem } from '../../lib/eagle-api';
import { updatePhotoGroup } from '../../lib/photo-management-api';
import { EagleAssetLightbox } from '../eagle/EagleAssetLightbox';
import { t } from '../../i18n';

export function PhotoStackLightbox({
  stack,
  onClose,
  onLocate,
  onEdit,
}: {
  stack: EaglePhotoStack;
  onClose: () => void;
  onLocate?: (assetId: string) => Promise<void>;
  onEdit?: (asset: EagleAssetListItem) => void;
}) {
  const { ownerId, api } = useLibraryWorkspace();
  const client = useQueryClient();
  const [assetId, setAssetId] = useState(stack.bestAssetId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = Math.max(0, stack.assetIds.indexOf(assetId));
  const currentId = stack.assetIds[index] ?? stack.cover.id;
  const asset = useQuery({
    queryKey: stackAssetKey(ownerId, currentId),
    queryFn: () => api.getEagleAsset('', currentId),
    enabled: currentId !== stack.cover.id,
  });
  const displayed = currentId === stack.cover.id ? stack.cover : asset.data;
  const pyramid = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'pyramid', currentId],
    queryFn: ({ signal }) => api.getEaglePyramidDescriptor('', currentId, signal),
    enabled: !!displayed && needsEagleImagePyramid(displayed.width, displayed.height),
    retry: false,
  });
  const select = (id: string) => {
    setError(null);
    setAssetId(id);
  };
  const move = (delta: number) => {
    setError(null);
    setAssetId(stack.assetIds[(index + delta + stack.assetIds.length) % stack.assetIds.length]);
  };
  async function changeCover() {
    setPending(true);
    setError(null);
    try {
      await updatePhotoGroup(stack.id, { bestAssetId: currentId });
      await client.invalidateQueries({ queryKey: ['eagle', ownerId, 'PHOTO'] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      setPending(false);
    }
  }
  return (
    <EagleAssetLightbox
      asset={displayed ?? stack.cover}
      loading={!displayed}
      loadError={asset.error?.message}
      onRetry={() => void asset.refetch()}
      descriptor={pyramid.data}
      collection={<PhotoStackFilmstrip stack={stack} selectedId={currentId} onSelect={select} />}
      onClose={onClose}
      onLocate={onLocate}
      onEdit={onEdit}
      navigation={{
        index,
        count: stack.assetIds.length,
        onPrevious: () => move(-1),
        onNext: () => move(1),
      }}
      actions={
        <>
          <button
            type="button"
            aria-label={t('设为主图')}
            disabled={pending || !displayed || stack.bestAssetId === currentId}
            onClick={() => void changeCover()}
          >
            {stack.bestAssetId === currentId ? (
              <IconStarFilled size={16} />
            ) : (
              <IconStar size={16} />
            )}
            <span data-viewer-compact-label>
              {stack.bestAssetId === currentId ? t('当前主图') : t('设为主图')}
            </span>
          </button>
          <button
            type="button"
            aria-label={t('取消分组')}
            title={t('取消分组')}
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void updatePhotoGroup(stack.id, { dismissed: true })
                .then(async () => {
                  await client.invalidateQueries({ queryKey: ['eagle', ownerId, 'PHOTO'] });
                  onClose();
                })
                .catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : t('操作失败')),
                )
                .finally(() => setPending(false));
            }}
          >
            <IconLayersSubtract size={18} />
          </button>
          {error && <span role="alert">{error}</span>}
        </>
      }
    />
  );
}
