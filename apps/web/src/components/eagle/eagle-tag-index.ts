import { t } from '../../i18n';
export interface EagleTagIndex {
  normalizedName: string;
  compactName: string;
  fullPinyin: string;
  pinyinInitials: string;
  section: string;
  sortKey: string;
}
export interface EagleTagIndexSource {
  name: string;
  pinyin: string;
  pinyinInitials: string;
}
export interface EagleTagSearchSource extends EagleTagIndexSource {
  id: string;
  assetCount: number;
  isStarred?: boolean;
}
const latinCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const HAN_CHARACTER = /^\p{Script=Han}$/u;
const LATIN_INITIAL = /^[a-z]$/i;
const DIGIT_INITIAL = /^\d$/;
function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}
export function createEagleTagIndex(source: EagleTagIndexSource): EagleTagIndex {
  const normalizedName = normalizeSearchText(source.name);
  const compactName = normalizedName.replace(/\s+/g, '');
  const fullPinyin = normalizeSearchText(source.pinyin).replace(/\s+/g, '');
  const pinyinInitials = normalizeSearchText(source.pinyinInitials).replace(/\s+/g, '');
  const firstCharacter = Array.from(normalizedName)[0] ?? '';
  let section = t('其他');
  if (LATIN_INITIAL.test(firstCharacter)) section = firstCharacter.toUpperCase();
  else if (DIGIT_INITIAL.test(firstCharacter)) section = '0–9';
  else if (HAN_CHARACTER.test(firstCharacter)) {
    const initial = fullPinyin.charAt(0);
    if (initial) section = initial.toUpperCase();
  }
  return {
    normalizedName,
    compactName,
    fullPinyin,
    pinyinInitials,
    section,
    sortKey: fullPinyin || compactName,
  };
}
export function eagleTagMatchesQuery(index: EagleTagIndex, query: string): boolean {
  return getEagleTagMatchRank(index, query) !== null;
}
function getEagleTagMatchRank(index: EagleTagIndex, query: string): number | null {
  const normalizedQuery = normalizeSearchText(query).replace(/\s+/g, '');
  if (!normalizedQuery) return 0;
  if (index.compactName === normalizedQuery) return 0;
  if (index.compactName.startsWith(normalizedQuery)) return 1;
  if (index.fullPinyin === normalizedQuery || index.pinyinInitials === normalizedQuery) return 2;
  if (
    index.fullPinyin.startsWith(normalizedQuery) ||
    index.pinyinInitials.startsWith(normalizedQuery)
  ) {
    return 3;
  }
  if (index.compactName.includes(normalizedQuery)) return 4;
  if (
    index.fullPinyin.includes(normalizedQuery) ||
    index.pinyinInitials.includes(normalizedQuery)
  ) {
    return 5;
  }
  return null;
}
export function searchAndSortEagleTags<T extends EagleTagSearchSource>(
  tags: T[],
  query: string,
  selectedTagIds: string[] = [],
): Array<{
  tag: T;
  index: EagleTagIndex;
}> {
  const selectedIds = new Set(selectedTagIds);
  return tags
    .map((tag) => {
      const index = createEagleTagIndex(tag);
      return { tag, index, matchRank: getEagleTagMatchRank(index, query) };
    })
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        matchRank: number;
      } => entry.matchRank !== null,
    )
    .sort(
      (left, right) =>
        left.matchRank - right.matchRank ||
        Number(selectedIds.has(right.tag.id)) - Number(selectedIds.has(left.tag.id)) ||
        Number(Boolean(right.tag.isStarred)) - Number(Boolean(left.tag.isStarred)) ||
        right.tag.assetCount - left.tag.assetCount ||
        compareEagleTagIndexes(left.index, right.index),
    )
    .map(({ tag, index }) => ({ tag, index }));
}
export function compareEagleTagIndexes(left: EagleTagIndex, right: EagleTagIndex): number {
  return (
    latinCollator.compare(left.sortKey, right.sortKey) ||
    latinCollator.compare(left.normalizedName, right.normalizedName)
  );
}
export function compareEagleTagSections(left: string, right: string): number {
  if (left === right) return 0;
  if (left === '0–9') return -1;
  if (right === '0–9') return 1;
  if (left === t('其他')) return 1;
  if (right === t('其他')) return -1;
  return latinCollator.compare(left, right);
}
