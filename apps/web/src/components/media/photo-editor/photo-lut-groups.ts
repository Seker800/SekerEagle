import { t } from '../../../i18n';
import type { PhotoFilter } from './photo-editor-model';
import type { PhotoLutEntry } from './photo-lut-storage';
export interface PhotoFilterGroup {
  id: string;
  label: string;
  items: { id: PhotoFilter; label: string }[];
}
/** Optional local convention: 01-Group__02-Name.cube. Personal entries remain separate from the immutable bundled catalog. */
export function photoLutFileName(
  filename: string,
): Pick<PhotoLutEntry, 'name' | 'group' | 'groupOrder' | 'order'> {
  const stem = filename.replace(/\.(cube|png)$/i, '').slice(0, 100);
  const separator = stem.indexOf('__');
  if (separator <= 0 || separator === stem.length - 2) return { name: stem };
  const ranked = (value: string) => {
    const match = /^(\d{1,3})-(.+)$/.exec(value.trim());
    return match ? { label: match[2].trim(), rank: Number(match[1]) } : { label: value.trim() };
  };
  const group = ranked(stem.slice(0, separator)),
    name = ranked(stem.slice(separator + 2));
  if (!group.label || !name.label) return { name: stem };
  return {
    name: name.label,
    group: group.label.slice(0, 40),
    ...(group.rank === undefined ? {} : { groupOrder: group.rank }),
    ...(name.rank === undefined ? {} : { order: name.rank }),
  };
}
export function groupPhotoFilters(entries: readonly PhotoLutEntry[]): PhotoFilterGroup[] {
  const grouped = new Map<string, { label: string; rank: number; entries: PhotoLutEntry[] }>();
  for (const entry of entries) {
    const label = entry.group?.trim() || t('其他');
    const rank = entry.groupOrder ?? Number.MAX_SAFE_INTEGER;
    const current = grouped.get(label);
    if (current) {
      current.rank = Math.min(current.rank, rank);
      current.entries.push(entry);
    } else grouped.set(label, { label, rank, entries: [entry] });
  }
  const groups: PhotoFilterGroup[] = [...grouped.values()]
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .map((group) => ({
      id: `local:${group.label}`,
      label: group.label,
      items: [...group.entries]
        .sort(
          (a, b) =>
            (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
            a.name.localeCompare(b.name),
        )
        .map((entry) => ({ id: `lut:${entry.id}`, label: entry.name })),
    }));
  groups.push({
    id: 'base',
    label: t('基础'),
    items: [
      { id: 'vintage', label: t('复古') },
      { id: 'oceanic', label: t('清冷') },
      { id: 'monochrome', label: t('黑白') },
    ],
  });
  return groups;
}
