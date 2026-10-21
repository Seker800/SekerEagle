import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import {
  listPhotoPeople,
  scanPhotoPeople,
  renamePhotoPerson,
  mergePhotoPeople,
  splitPhotoFace,
  type PhotoPerson,
} from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';

export function PhotoCollections({
  includePrivate,
  onOpen,
  onPerson,
}: {
  includePrivate: boolean;
  onOpen: (asset: EagleAssetListItem) => void;
  onPerson: (personId: string) => void;
}) {
  const { ownerId, api } = useLibraryWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const people = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people', includePrivate],
    queryFn: listPhotoPeople,
    refetchInterval: 10000,
  });
  async function perform(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
      await people.refetch();
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
