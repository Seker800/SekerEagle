/** Browsing excludes stale, editing and motion derivatives in every consumer. */
interface BrowseRendition {
  kind: string;
  revision: number;
  variant?: string | null;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
}
interface BrowseAsset<R extends BrowseRendition> {
  mediaRevision: number;
  mimeType: string;
  renditions: readonly R[];
}
export function selectBrowseRendition<R extends BrowseRendition>(
  asset: BrowseAsset<R>,
): R | undefined {
  const current = asset.renditions.filter((row) => row.revision === asset.mediaRevision);
  return (
    current.find(
      ({ kind, mimeType, variant }) =>
        variant !== 'edit' &&
        kind === 'PREVIEW' &&
        (!asset.mimeType.startsWith('image/') || !mimeType || mimeType.startsWith('image/')),
    ) ?? current.find(({ kind }) => kind === 'THUMBNAIL')
  );
}
export function representativePhotoFace<
  T extends { box: readonly number[]; asset: BrowseAsset<BrowseRendition> },
>(faces: readonly T[]): T | undefined {
  let best: T | undefined;
  let pixels = -1;
  for (const face of faces) {
    const preview = selectBrowseRendition(face.asset);
    if (!preview) continue;
    const score =
      (preview.width ?? 0) * (preview.height ?? 0) * (face.box[2] ?? 0) * (face.box[3] ?? 0);
    if (score > pixels) {
      best = face;
      pixels = score;
    }
  }
  return best;
}
