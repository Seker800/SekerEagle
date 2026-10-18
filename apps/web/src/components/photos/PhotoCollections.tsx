import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  listPhotoGroups,
  removePhotoGroupMembers,
  mergePhotoGroups,
  listPhotoPeople,
  scanPhotoGroups,
  scanPhotoPeople,
  renamePhotoPerson,
  mergePhotoPeople,
  splitPhotoFace,
  updatePhotoGroup,
  type PhotoPerson,
} from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';

export function PhotoCollections({
  view,
  includePrivate,
  onOpen,
  onPerson,
}: {
  view: 'people' | 'groups';
  includePrivate: boolean;
  onOpen: (asset: EagleAssetListItem) => void;
  onPerson: (personId: string) => void;
}) {
  const { ownerId, api } = useLibraryWorkspace();
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const people = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people', includePrivate],
    queryFn: listPhotoPeople,
    enabled: view === 'people',
    refetchInterval: 10000,
  });
  const groups = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'groups', includePrivate],
    queryFn: listPhotoGroups,
    enabled: view === 'groups',
  });
  async function perform(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
      await Promise.all([people.refetch(), groups.refetch()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      setPending(false);
    }
  }
  const thumbnail = (asset: EagleAssetListItem) => {
    const rendition =
      asset.renditions.find((row) => row.kind === 'THUMBNAIL') ?? asset.renditions[0];
    return rendition
      ? api.getEagleRenditionContentUrl(asset.id, rendition.id, rendition.kind)
      : null;
  };
  return (
    <section className="photo-collections">
      <div className="photo-collections-header">
        <h2>{view === 'people' ? t('人物') : t('照片组')}</h2>
        <button
          type="button"
          disabled={pending || (view === 'people' && people.data?.runtimeConfigured === false)}
          onClick={() =>
            void perform(async () => {
              if (view === 'people') {
                const result = await scanPhotoPeople();
                setFeedback(t('已加入 {{value1}} 个本地人脸分析任务', { value1: result.queued }));
              } else {
                const result = await scanPhotoGroups();
                setFeedback(
                  t('分析 {{value1}} 张照片，新增 {{value2}} 个照片组', {
                    value1: result.scanned,
                    value2: result.created,
                  }),
                );
              }
            })
          }
        >
          {view === 'people' ? t('分析人物') : t('查找连拍与相似照片')}
        </button>
      </div>
      {view === 'people' && people.data?.runtimeConfigured === false && (
        <p>{t('本地人物模型尚未启用，安装后可分析人物。')}</p>
      )}
      {feedback && <p role="status">{feedback}</p>}
      {(error || people.error || groups.error) && (
        <p role="alert">{error ?? people.error?.message ?? groups.error?.message}</p>
      )}
      {view === 'people' ? (
        <>
          <div className="photo-person-grid">
            {people.data?.people.map((person, index) => {
              const face = person.faces[0],
                src = face ? thumbnail(face.asset) : null;
              return (
                <button
                  type="button"
                  key={person.id}
                  className="photo-person-card"
                  onClick={() => setSelectedPerson(person.id)}
                  aria-pressed={selectedPerson === person.id}
                >
                  {src && face && (
                    <span className="photo-face-crop">
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        style={{
                          width: `${100 / Math.max(0.01, face.box[2])}%`,
                          height: `${100 / Math.max(0.01, face.box[3])}%`,
                          left: `${(-face.box[0] / Math.max(0.01, face.box[2])) * 100}%`,
                          top: `${(-face.box[1] / Math.max(0.01, face.box[3])) * 100}%`,
                        }}
                      />
                    </span>
                  )}
                  <strong>
                    {person.name ?? t('未命名人物 {{value1}}', { value1: index + 1 })}
                  </strong>
                </button>
              );
            })}
          </div>
          {people.data?.people.find((person) => person.id === selectedPerson) && (
            <PersonEditor
              key={selectedPerson}
              person={people.data.people.find((person) => person.id === selectedPerson)!}
              people={people.data.people}
              pending={pending}
              perform={perform}
              onPerson={onPerson}
              onOpen={onOpen}
              thumbnail={thumbnail}
            />
          )}
          {!people.isPending && people.data?.people.length === 0 && (
            <p>{t('尚未发现人物。导入照片后可运行本地分析。')}</p>
          )}
        </>
      ) : (
        <>
          <p>{t('清晰度只作参考，所有原片都会保留。')}</p>
          {groups.data?.map((group) => (
            <article className="photo-group" key={group.id}>
              <div className="photo-collections-header">
                <h3>
                  {group.kind === 'MANUAL'
                    ? t('手动照片组')
                    : group.kind === 'BURST'
                      ? t('连拍组')
                      : t('相似照片组')}
                </h3>
                <select
                  aria-label={t('合并照片组')}
                  value={mergeTargets[group.id] ?? ''}
                  onChange={(event) =>
                    setMergeTargets((current) => ({ ...current, [group.id]: event.target.value }))
                  }
                >
                  <option value="">{t('选择照片组')}</option>
                  {groups.data
                    ?.filter((other) => other.id !== group.id)
                    .map((other, index) => (
                      <option key={other.id} value={other.id}>
                        {t('照片组 {{value1}}', { value1: index + 1 })}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={pending || !mergeTargets[group.id]}
                  onClick={() =>
                    void perform(() => mergePhotoGroups(group.id, mergeTargets[group.id]))
                  }
                >
                  {t('合并照片组')}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void perform(() => updatePhotoGroup(group.id, { dismissed: true }))
                  }
                >
                  {t('取消分组')}
                </button>
              </div>
              <div className="photo-group-grid">
                {group.members.map(({ asset }) => {
                  const src = thumbnail(asset);
                  return (
                    <div key={asset.id}>
                      <button type="button" onClick={() => onOpen(asset)}>
                        {src && <img loading="lazy" src={src} alt={asset.displayName} />}
                      </button>
                      <p>{asset.displayName}</p>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          void perform(() => removePhotoGroupMembers(group.id, [asset.id]))
                        }
                      >
                        {t('从组中移除')}
                      </button>
                      {group.bestAssetId === asset.id ? (
                        <strong>
                          {group.bestSelectedByUser ? t('已选代表照片') : t('建议保留的代表照片')}
                        </strong>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            void perform(() =>
                              updatePhotoGroup(group.id, { bestAssetId: asset.id }),
                            )
                          }
                        >
                          {t('设为代表照片')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
          {!groups.isPending && groups.data?.length === 0 && (
            <p>{t('还没有照片组，可先查找连拍与相似照片。')}</p>
          )}
        </>
      )}
    </section>
  );
}
function PersonEditor({
  person,
  people,
  pending,
  perform,
  onPerson,
  onOpen,
  thumbnail,
}: {
  person: PhotoPerson;
  people: PhotoPerson[];
  pending: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
  onPerson: (id: string) => void;
  onOpen: (asset: EagleAssetListItem) => void;
  thumbnail: (asset: EagleAssetListItem) => string | null;
}) {
  const [name, setName] = useState(person.name ?? '');
  const [target, setTarget] = useState('');
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
      <button type="button" onClick={() => onPerson(person.id)}>
        {t('查看此人物的照片')}
      </button>
      <label>
        {t('合并到人物')}
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">{t('选择人物')}</option>
          {people
            .filter((row) => row.id !== person.id)
            .map((row, index) => (
              <option key={row.id} value={row.id}>
                {row.name ?? t('未命名人物 {{value1}}', { value1: index + 1 })}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!target || pending}
        onClick={() => void perform(() => mergePhotoPeople(person.id, target))}
      >
        {t('合并人物')}
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
                onClick={() => void perform(() => splitPhotoFace(face.id))}
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
