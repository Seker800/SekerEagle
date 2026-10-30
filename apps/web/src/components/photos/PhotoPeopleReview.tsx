import { useRef, useState } from 'react';
import { t } from '../../i18n';
import type { PhotoPerson, PhotoPeopleReviewPair } from '../../lib/photo-management-api';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { PhotoFaceImage, representativeFace } from './PhotoFaceImage';

export function PhotoPeopleReview({
  pairs,
  pending,
  onConfirm,
  onOpen,
  preview,
}: {
  pairs: PhotoPeopleReviewPair[];
  pending: boolean;
  onConfirm: (source: PhotoPerson, target: PhotoPerson) => Promise<boolean>;
  onOpen: (asset: EagleAssetListItem) => void;
  preview: (asset: EagleAssetListItem) => string | null;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [merged, setMerged] = useState<Set<string>>(new Set());
  const submitting = useRef(false);
  const candidates = pairs.filter(
    ({ first, second }) =>
      !merged.has(first.id) &&
      !merged.has(second.id) &&
      representativeFace(first) &&
      representativeFace(second),
  );
  const candidate = candidates.find(({ first, second }) => !skipped.has(pairKey(first, second)));
  const pair: [PhotoPeopleReviewPair['first'], PhotoPeopleReviewPair['second']] | undefined =
    candidate ? [candidate.first, candidate.second] : undefined;
  if (!candidates.length) return null;
  if (!pair)
    return (
      <div className="photo-people-review">
        <p>{t('本批疑似组合已比较完，可重新比较。')}</p>
        <button type="button" disabled={pending} onClick={() => setSkipped(new Set())}>
          {t('重新比较')}
        </button>
      </div>
    );
  const current = pair;
  const [first, second] = current;
  const [source, target] = !first.name && second.name ? [first, second] : [second, first];
  return (
    <section className="photo-people-review" aria-label={t('这两张照片是同一个人吗？')}>
      <h3>{t('这两张照片是同一个人吗？')}</h3>
      <div className="photo-people-review-pair">
        {current.map((person) => {
          const face = representativeFace(person);
          if (!face) return null;
          return (
            <button type="button" key={person.id} onClick={() => onOpen(face.asset)}>
              <img
                className="photo-people-review-original"
                src={preview(face.asset) ?? undefined}
                alt={t('完整照片：{{value1}}', { value1: face.asset.displayName })}
              />
              <PhotoFaceImage face={face} url={preview} alt={face.asset.displayName} />
              <span>{person.name ?? t('未命名人物')}</span>
              <span>{t('{{value1}} 张照片', { value1: person.photoCount })}</span>
            </button>
          );
        })}
      </div>
      {target.name && <p>{t('合并后保留名称：{{value1}}', { value1: target.name })}</p>}
      <div className="photo-people-review-actions">
        <button
          type="button"
          disabled={pending}
          onKeyDown={(event) => {
            if (event.repeat) event.preventDefault();
          }}
          onClick={(event) => {
            if (event.detail > 1 || submitting.current) return;
            submitting.current = true;
            void onConfirm(source, target)
              .then((success) => {
                if (success) {
                  setMerged((old) => new Set([...old, source.id]));
                }
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
