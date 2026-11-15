import { t } from '../../i18n';
import type { PhotoPerson } from '../../lib/photo-management-api';

export function photoPersonLabel(
  person: Pick<PhotoPerson, 'id' | 'name' | 'photoCount'>,
  includeCount = false,
) {
  if (person.name) return person.name;
  const shortId = person.id.replace(/-/g, '').slice(-6);
  return includeCount && person.photoCount !== undefined
    ? t('未命名 · {{value1}} 张 · #{{value2}}', {
        value1: person.photoCount,
        value2: shortId,
      })
    : t('未命名 · #{{value1}}', { value1: shortId });
}
