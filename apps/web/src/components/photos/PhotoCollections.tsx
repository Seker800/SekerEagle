import { usePhotoPeople } from './use-photo-people';
import { getDesktopCacheBridge } from '../../lib/media-resolver';
import { useRef, useState } from 'react';
import { PhotoFaceImage, facePreview, representativeFace } from './PhotoFaceImage';
import { PhotoPeopleReview } from './PhotoPeopleReview';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  scanPhotoPeople,
  reviewPhotoPeople,
  renamePhotoPerson,
  mergePhotoPeople,
  splitPhotoFace,
  updatePhotoPersonPrivacy,
  type PhotoPerson,
} from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';

export function PhotoCollections({
  includePrivate,
  onOpen,
  onPerson,
  onPrivacyRulesChange,
}: {
  includePrivate: boolean;
  onPrivacyRulesChange: () => void;
  onOpen: (asset: EagleAssetListItem) => void;
  onPerson: (personId: string) => void;
}) {
  const { ownerId, api } = useLibraryWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const people = usePhotoPeople(ownerId, includePrivate, true, true);
  const review = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people-review', includePrivate],
    queryFn: ({ signal }) => reviewPhotoPeople(signal),
    staleTime: 30000,
  });
  const actionPending = useRef(false);
  async function perform(action: () => Promise<unknown>, changesPrivacy = false) {
    if (actionPending.current) return false;
    actionPending.current = true;
    setError(null);
    setPending(true);
    try {
      await action();
      if (changesPrivacy) {
        onPrivacyRulesChange();
        try {
          await getDesktopCacheBridge()?.clearCache();
        } catch {
          setError(t('隐私规则已保存，但桌面媒体缓存清理失败。'));
        }
      }
      if (!changesPrivacy)
        await queryClient.invalidateQueries({
          queryKey: ['eagle', ownerId, 'PHOTO', 'asset-detail'],
        });
      await Promise.all([people.refetch(), review.refetch()]);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
      return false;
    } finally {
      actionPending.current = false;
      setPending(false);
    }
  }
  const thumbnail = (asset: EagleAssetListItem) => {
    const rendition = facePreview(asset);
    return rendition
      ? api.getEagleRenditionContentUrl(asset.id, rendition.id, rendition.kind)
      : null;
  };
  return (
    <section className="photo-collections">
      <div className="photo-collections-header">
        <h2>{t('人物')}</h2>
        <button
          type="button"
          disabled={
            pending ||
            people.isPending ||
            Boolean(people.error) ||
            people.data?.runtimeConfigured !== true
          }
          onClick={() =>
            void perform(async () => {
              const result = await scanPhotoPeople();
              setFeedback(t('已加入 {{value1}} 个本地人脸分析任务', { value1: result.queued }));
            })
          }
        >
          {t('分析人物')}
        </button>
      </div>
      {people.isPending && <p role="status">{t('正在加载人物…')}</p>}
      {!people.isPending && !people.error && people.data?.runtimeConfigured === false && (
        <p role="status">{t('人物识别服务尚未配置，暂时无法分析照片。')}</p>
      )}
      {feedback && <p role="status">{feedback}</p>}
      {(error || people.error) && <p role="alert">{error ?? people.error?.message}</p>}
      {
        <>
          {review.error && <p role="alert">{review.error.message}</p>}
          <PhotoPeopleReview
            key={`${ownerId}:${includePrivate}`}
            pairs={review.data?.pairs ?? []}
            pending={pending}
            onConfirm={(source, target) =>
              perform(async () => {
                await mergePhotoPeople(source.id, target.id);
                setSelectedPerson(null);
                setFeedback(t('人物已合并'));
              }, true)
            }
            onOpen={onOpen}
            preview={thumbnail}
          />
          <div className="photo-person-grid">
            {people.data?.people.map((person, index) => {
              const face = representativeFace(person),
                src = face ? thumbnail(face.asset) : null;
              return (
                <button
                  type="button"
                  key={person.id}
                  className="photo-person-card"
                  onClick={() => setSelectedPerson(person.id)}
                  aria-pressed={selectedPerson === person.id}
                >
                  {src && face && <PhotoFaceImage face={face} url={thumbnail} />}
                  <strong>
                    {person.name ?? t('未命名人物 {{value1}}', { value1: index + 1 })}
                  </strong>
                </button>
              );
            })}
          </div>
          {people.hasNextPage && (
            <button
              type="button"
              disabled={people.isFetchingNextPage}
              onClick={() => void people.fetchNextPage()}
            >
              {t('加载更多人物')}
            </button>
          )}
          {people.data?.people.find((person) => person.id === selectedPerson) && (
            <PersonEditor
              key={selectedPerson}
              person={people.data.people.find((person) => person.id === selectedPerson)!}
              pending={pending}
              perform={(action, changesPrivacy) => perform(action, changesPrivacy)}
              onPrivacyChange={(person, checked) =>
                perform(async () => {
                  await updatePhotoPersonPrivacy(person, checked);
                  setFeedback(
                    checked && !includePrivate
                      ? t('已设为私密，开启显示隐私内容后可管理。')
                      : t('人物隐私规则已更新。'),
                  );
                }, true)
              }
              onPerson={onPerson}
              onOpen={onOpen}
              thumbnail={thumbnail}
            />
          )}
          {!people.isPending &&
            !people.error &&
            !feedback &&
            people.data?.runtimeConfigured === true &&
            people.data.people.length === 0 && (
              <p>{t('暂无人物。可点击“分析人物”扫描图库中的照片。')}</p>
            )}
        </>
      }
    </section>
  );
}
function PersonEditor({
  person,
  pending,
  perform,
  onPerson,
  onOpen,
  thumbnail,
  onPrivacyChange,
}: {
  person: PhotoPerson;
  pending: boolean;
  perform: (action: () => Promise<unknown>, changesPrivacy?: boolean) => Promise<boolean>;
  onPrivacyChange: (person: PhotoPerson, checked: boolean) => Promise<boolean>;
  onPerson: (id: string) => void;
  onOpen: (asset: EagleAssetListItem) => void;
  thumbnail: (asset: EagleAssetListItem) => string | null;
}) {
  const [name, setName] = useState(person.name ?? '');
  return (
    <div className="photo-person-editor">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(() => renamePhotoPerson(person.id, name));
        }}
      >
        <label>
          {t('人物名称')}
          <input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button disabled={pending}>{t('保存')}</button>
      </form>
      <label className="privacy-switch-row">
        <span>{t('包含此人的照片设为私密')}</span>
        <input
          type="checkbox"
          checked={person.marksAssetsPrivate ?? false}
          disabled={pending}
          onChange={(event) => void onPrivacyChange(person, event.currentTarget.checked)}
        />
      </label>
      <p>{t('私密标签或私密人物任一命中，整张照片都会隐藏，包括合照。人物合并会保留私密规则。')}</p>
      <p>{t('识别可能漏检，敏感照片请同时手动添加私密标签。')}</p>
      <button type="button" onClick={() => onPerson(person.id)}>
        {t('查看此人物的照片')}
      </button>
      <div className="photo-group-grid">
        {person.faces.slice(0, 20).map((face) => {
          const src = thumbnail(face.asset);
          return (
            <div key={face.id}>
              <button type="button" onClick={() => onOpen(face.asset)}>
                {src && <img loading="lazy" src={src} alt={face.asset.displayName} />}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => void perform(() => splitPhotoFace(face.id), true)}
              >
                {t('这不是同一个人')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
