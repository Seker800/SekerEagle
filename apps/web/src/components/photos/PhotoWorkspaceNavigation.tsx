import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { getPhotoFacets, createPhotoGroup } from '../../lib/photo-management-api';
import type { Dispatch, SetStateAction } from 'react';
import { t } from '../../i18n';
import type { EagleAssetFilters } from '../../lib/eagle-api';
export type PhotoView = 'timeline' | 'map' | 'people' | 'groups';
export type PhotoFilters = Pick<
  EagleAssetFilters,
  'cameraModel' | 'lensModel' | 'gps' | 'personId'
>;
export function PhotoWorkspaceNavigation({
  view,
  filters,
  onViewChange,
  onFiltersChange,
  includePrivate,
  selectedAssetIds,
}: {
  selectedAssetIds: readonly string[];
  includePrivate: boolean;
  view: PhotoView;
  filters: PhotoFilters;
  onViewChange: (view: PhotoView) => void;
  onFiltersChange: Dispatch<SetStateAction<PhotoFilters>>;
}) {
  const { ownerId } = useLibraryWorkspace();
  const facets = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'photography-facets', includePrivate],
    queryFn: getPhotoFacets,
    staleTime: 30000,
  });
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function createGroup() {
    setCreating(true);
    setError(null);
    try {
      await createPhotoGroup(selectedAssetIds);
      await client.invalidateQueries({ queryKey: ['eagle', ownerId, 'PHOTO', 'groups'] });
      onViewChange('groups');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      setCreating(false);
    }
  }
  return (
    <div className="photo-toolbar">
      {selectedAssetIds.length >= 2 && (
        <button type="button" disabled={creating} onClick={() => void createGroup()}>
          {t('创建照片组')}
        </button>
      )}
      {error && <span role="alert">{error}</span>}
      <button
        type="button"
        aria-pressed={view === 'timeline'}
        onClick={() => onViewChange('timeline')}
      >
        {t('时间线')}
      </button>
      <button type="button" aria-pressed={view === 'map'} onClick={() => onViewChange('map')}>
        {t('地图')}
      </button>
      <button type="button" aria-pressed={view === 'people'} onClick={() => onViewChange('people')}>
        {t('人物')}
      </button>
      <button type="button" aria-pressed={view === 'groups'} onClick={() => onViewChange('groups')}>
        {t('照片组')}
      </button>
      {filters.personId && (
        <button
          type="button"
          onClick={() => onFiltersChange((current) => ({ ...current, personId: undefined }))}
        >
          {t('清除人物筛选')}
        </button>
      )}
      <input
        list="photo-camera-models"
        aria-label={t('按相机筛选')}
        placeholder={t('按相机筛选')}
        value={filters.cameraModel ?? ''}
        onChange={(event) =>
          onFiltersChange((current) => ({
            ...current,
            cameraModel: event.target.value || undefined,
          }))
        }
      />
      <input
        list="photo-lens-models"
        aria-label={t('按镜头筛选')}
        placeholder={t('按镜头筛选')}
        value={filters.lensModel ?? ''}
        onChange={(event) =>
          onFiltersChange((current) => ({
            ...current,
            lensModel: event.target.value || undefined,
          }))
        }
      />
      <datalist id="photo-camera-models">
        {facets.data?.cameras.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="photo-lens-models">
        {facets.data?.lenses.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <select
        aria-label="GPS"
        value={filters.gps ?? ''}
        onChange={(event) =>
          onFiltersChange((current) => ({
            ...current,
            gps: (event.target.value || undefined) as 'WITH' | 'WITHOUT' | undefined,
          }))
        }
      >
        <option value="">{t('全部位置')}</option>
        <option value="WITH">{t('有 GPS')}</option>
        <option value="WITHOUT">{t('无 GPS')}</option>
      </select>
    </div>
  );
}
