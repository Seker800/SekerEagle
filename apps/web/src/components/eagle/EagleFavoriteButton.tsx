import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IconHeart, IconHeartFilled } from '@tabler/icons-react';
import { t, tForLocale } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';

type FavoriteApi = Pick<
  ReturnType<typeof useLibraryWorkspace>['api'],
  | 'listEagleManualTags'
  | 'createEagleManualTag'
  | 'batchChangeEagleManualTags'
  | 'getEaglePrivacySettings'
>;
// Persisted names are independent of the display language and scoped by the existing API.
const FAVORITE_TAG = tForLocale('zh-CN', '收藏');
export function isLibraryFavorite(asset: EagleAssetListItem) {
  return asset.manualTags?.some((tag) => tag.name === FAVORITE_TAG) ?? false;
}
export async function setLibraryFavorite(api: FavoriteApi, assetIds: string[], enabled: boolean) {
  if (!assetIds.length) return;
  let tag = (await api.listEagleManualTags('')).find((item) => item.name === FAVORITE_TAG);
  if (enabled && !tag) {
    try {
      tag = await api.createEagleManualTag('', { name: FAVORITE_TAG });
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'status' in reason && reason.status === 409))
        throw reason;
      tag = (await api.listEagleManualTags('')).find((item) => item.name === FAVORITE_TAG);
      if (!tag) throw reason;
    }
  }
  if (!tag) return;
  const privacy = await api.getEaglePrivacySettings();
  if (privacy.tagIds.includes(tag.id)) throw new Error(t('收藏标签被设为私密，请先在设置中调整。'));
  await api.batchChangeEagleManualTags('', {
    assetIds,
    addTagIds: enabled ? [tag.id] : [],
    removeTagIds: enabled ? [] : [tag.id],
  });
}
export async function toggleViewerFavorite(
  api: FavoriteApi,
  asset: EagleAssetListItem,
  favorite: boolean,
) {
  await setLibraryFavorite(api, [asset.id], !favorite);
}

export function EagleFavoriteButton(props: {
  assets: EagleAssetListItem[];
  disabled?: boolean;
  role?: 'menuitem';
}) {
  const { ownerId, libraryMode } = useLibraryWorkspace();
  return (
    <FavoriteButton
      key={`${ownerId}:${libraryMode}:${props.assets.map((asset) => asset.id).join(',')}`}
      {...props}
    />
  );
}
function FavoriteButton({
  assets,
  disabled,
  role,
}: {
  assets: EagleAssetListItem[];
  disabled?: boolean;
  role?: 'menuitem';
}) {
  const { api, ownerId, libraryMode } = useLibraryWorkspace();
  const client = useQueryClient();
  const allFavorite = assets.length > 0 && assets.every(isLibraryFavorite);
  const [favorite, setFavorite] = useState(allFavorite);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const alive = useRef(true);
  useEffect(() => setFavorite(allFavorite), [allFavorite]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const toggle = async () => {
    if (locked.current || disabled) return;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      await setLibraryFavorite(
        api,
        assets.map((asset) => asset.id),
        !favorite,
      );
      if (alive.current) setFavorite(!favorite);
      await client.invalidateQueries({ queryKey: ['eagle', ownerId, libraryMode] });
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      locked.current = false;
      if (alive.current) setPending(false);
    }
  };
  return (
    <>
      <button
        type="button"
        role={role}
        aria-pressed={favorite}
        title={t('使用收藏标签')}
        disabled={disabled || pending || !assets.length}
        onClick={() => void toggle()}
      >
        {favorite ? <IconHeartFilled size={18} /> : <IconHeart size={18} />}
        <span>{favorite ? t('已收藏') : t('收藏')}</span>
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
