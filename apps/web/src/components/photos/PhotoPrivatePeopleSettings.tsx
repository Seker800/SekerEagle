import { usePhotoPeople } from './use-photo-people';
import { getDesktopCacheBridge } from '../../lib/media-resolver';
import { useState } from 'react';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  updatePhotoPersonPrivacy,
  type PhotoPerson,
} from '../../lib/photo-management-api';

export function PhotoPrivatePeopleSettings({
  includePrivate,
  onRulesChange,
}: {
  includePrivate: boolean;
  onRulesChange: () => void;
}) {
  const { ownerId } = useLibraryWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = usePhotoPeople(ownerId, includePrivate, includePrivate);
  async function unmark(person: PhotoPerson) {
    setPending(true);
    setError(null);
    try {
      await updatePhotoPersonPrivacy(person, false);
      onRulesChange();
      try {
        await getDesktopCacheBridge()?.clearCache();
      } catch {
        setError(t('隐私规则已保存，但桌面媒体缓存清理失败。'));
      }
      await people.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="privacy-tag-settings photo-private-people">
      <div>
        <strong>{t('私密人物')}</strong>
        <small>{t('在人物页面选择某人，可将包含此人的照片设为私密。')}</small>
        {!includePrivate ? (
          <small>{t('开启显示隐私内容后，可在这里解除私密人物规则。')}</small>
        ) : (
          <ul className="photo-private-people-list">
            {people.data?.people
              .filter((person) => person.marksAssetsPrivate)
              .map((person) => (
                <li key={person.id}>
                  <span>{person.name ?? t('未命名人物')}</span>
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={pending}
                    onClick={() => void unmark(person)}
                  >
                    {t('解除人物私密')}
                  </button>
                </li>
              ))}
          </ul>
        )}
      {people.hasNextPage && <button type="button" disabled={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>{t('加载更多人物')}</button>}
        {(error || people.error) && <p role="alert">{error ?? people.error?.message}</p>}
      </div>
    </div>
  );
}
