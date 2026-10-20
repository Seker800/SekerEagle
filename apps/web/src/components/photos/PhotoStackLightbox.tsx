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
  const currentId = stack.assetIds[index];
  const asset = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'stack-asset', currentId],
    queryFn: () => api.getEagleAsset('', currentId),
    enabled: currentId !== stack.cover.id,
  });
  const displayed = currentId === stack.cover.id ? stack.cover : asset.data;
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
          <span>{stack.bestAssetId === currentId ? t('当前主图') : ''}</span>
          <button
            type="button"
            disabled={pending || !displayed || stack.bestAssetId === currentId}
            onClick={() => void changeCover()}
          >
            {t('设为主图')}
          </button>
          <button
            type="button"
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
            {t('取消分组')}
          </button>
          {(error || asset.error) && <span role="alert">{error ?? asset.error?.message}</span>}
        </>
      }
    />
  );
}
