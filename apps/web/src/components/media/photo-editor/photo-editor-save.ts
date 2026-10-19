import { t } from '../../../i18n';

export interface SavedPhoto {
  id: string;
  name: string;
}
export function editedPhotoName(name: string, now = new Date()): string {
  const base =
    Array.from(
      name
        .replace(/\.(?:jpe?g|png|webp)$/i, '')
        .replace(/[\\/]/g, '_')
        .trim(),
    )
      .slice(0, 70)
      .join('') || 'photo';
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace('Z', '')
    .replace('.', '-');
  return `${base}-${t('已编辑')}-${timestamp}.png`;
}
