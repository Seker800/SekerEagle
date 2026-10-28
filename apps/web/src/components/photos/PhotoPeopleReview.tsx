import { useRef, useState } from 'react';
import { t } from '../../i18n';
import type { PhotoPerson } from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { PhotoFaceImage, representativeFace } from './PhotoFaceImage';

export function PhotoPeopleReview({
  people,
  pending,
  onConfirm,
  onOpen,
  preview,
}: {
  people: PhotoPerson[];
  pending: boolean;
  onConfirm: (source: PhotoPerson, target: PhotoPerson) => Promise<boolean>;
  onOpen: (asset: EagleAssetListItem) => void;
  preview: (asset: EagleAssetListItem) => string | null;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [merged, setMerged] = useState<Set<string>>(new Set());
  const submitting = useRef(false);
  const candidates = people.filter(
    (person) => !merged.has(person.id) && representativeFace(person),
  );
  let pair: [PhotoPerson, PhotoPerson] | undefined;
  for (let i = 0; i < candidates.length && !pair; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (!skipped.has(pairKey(candidates[i], candidates[j]))) {
        pair = [candidates[i], candidates[j]];
        break;
      }
    }
  }
  if (candidates.length < 2) return null;
  if (!pair)
    return (
      <div className="photo-people-review">
        <p>{t('本批人物已比较完，可加载更多人物或重新比较。')}</p>
        <button type="button" disabled={pending} onClick={() => setSkipped(new Set())}>
          {t('重新比较')}
        </button>
      </div>
    );
  const current = pair;
  return (
    <section className="photo-people-review" aria-label={t('这两张照片是同一个人吗？')}>
      <h3>{t('这两张照片是同一个人吗？')}</h3>
      <div className="photo-people-review-pair">
        {current.map((person) => {
          const face = representativeFace(person);
          return (
            <button type="button" key={person.id} onClick={() => onOpen(face.asset)}>
              <PhotoFaceImage face={face} url={preview} alt={face.asset.displayName} />
              <span>{person.name ?? t('未命名人物')}</span>
            </button>
          );
        })}
      </div>
      <div className="photo-people-review-actions">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (submitting.current) return;
            submitting.current = true;
            const [first, second] = current;
            const [source, target] = !first.name && second.name ? [first, second] : [second, first];
            void onConfirm(source, target)
              .then((success) => {
                if (success) setMerged((old) => new Set([...old, source.id]));
              })
              .finally(() => {
                submitting.current = false;
              });
          }}
        >
          {t('是，同一个人')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setSkipped((old) => new Set([...old, pairKey(...current)]));
          }}
        >
          {t('换一批')}
        </button>
      </div>
    </section>
  );
}
function pairKey(a: PhotoPerson, b: PhotoPerson) {
  return JSON.stringify([a.id, b.id].sort());
}
