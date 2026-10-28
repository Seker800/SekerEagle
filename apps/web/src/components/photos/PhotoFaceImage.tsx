import type { PhotoFace, PhotoPerson } from '../../lib/photo-management-api';
import { selectEagleBrowseRendition } from '../../lib/eagle-browse-rendition';
import type { EagleAssetListItem, EagleRendition } from '../../lib/eagle-api';

/** Face crops use the current browsing image, never RAW editing or motion media. */
export function facePreview(asset: EagleAssetListItem): EagleRendition | undefined {
  return selectEagleBrowseRendition(asset);
}

export function representativeFace(person: PhotoPerson): PhotoFace | undefined {
  return person.faces
    .filter((face) => facePreview(face.asset))
    .sort((a, b) => facePixels(b) - facePixels(a))[0];
}
function facePixels(face: PhotoFace) {
  const preview = facePreview(face.asset);
  return (preview?.width ?? 0) * (preview?.height ?? 0) * face.box[2] * face.box[3];
}

export function PhotoFaceImage({
  face,
  url,
  alt = '',
}: {
  face: PhotoFace;
  url: (asset: EagleAssetListItem) => string | null;
  alt?: string;
}) {
  const src = url(face.asset);
  if (!src) return <span className="photo-face-crop" />;
  const preview = facePreview(face.asset);
  const width = preview?.width || face.asset.width || 1;
  const height = preview?.height || face.asset.height || 1;
  const [x = 0, y = 0, w = 1, h = 1] = face.box;
  // A square in source pixels preserves facial proportions and includes some context.
  const side = Math.max(1, Math.max(w * width, h * height) * 1.35);
  const left = (x + w / 2) * width - side / 2;
  const top = (y + h / 2) * height - side / 2;
  return (
    <span className="photo-face-crop">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          width: `${(width / side) * 100}%`,
          height: `${(height / side) * 100}%`,
          left: `${(-left / side) * 100}%`,
          top: `${(-top / side) * 100}%`,
        }}
      />
    </span>
  );
}
