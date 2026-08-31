import { t } from '../../i18n';
import { useMemo, useState, type ReactNode } from 'react';
import { IconSearch, IconStarFilled, IconX } from '@tabler/icons-react';
import { searchAndSortEagleTags, type EagleTagSearchSource } from './eagle-tag-index';
import { EagleVirtualList } from './EagleVirtualList';
import styles from './EagleTagConditionPicker.module.css';
interface EagleTagConditionPickerProps<
  T extends EagleTagSearchSource & {
    color?: string | null;
  },
> {
  label: string;
  icon: ReactNode;
  tags: T[];
  selectedTagIds: string[];
  emptyText: string;
  onChange: (tagIds: string[]) => void;
}
export function EagleTagConditionPicker<
  T extends EagleTagSearchSource & {
    color?: string | null;
  },
>({ label, icon, tags, selectedTagIds, emptyText, onChange }: EagleTagConditionPickerProps<T>) {
  const [query, setQuery] = useState('');
  const searchLabel = label.startsWith('AI ')
    ? t('搜索 {{value1}}', {
        value1: label,
      })
    : t('搜索{{value1}}', {
        value1: label,
      });
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const selectedTags = selectedTagIds.flatMap((id) => {
    const tag = tagsById.get(id);
    return tag ? [tag] : [];
  });
  const visibleTags = useMemo(
    () => searchAndSortEagleTags(tags, query, selectedTagIds),
    [query, selectedTagIds, tags],
  );
  const toggleTag = (tagId: string) => {
    onChange(
      selectedTagIds.includes(tagId)
        ? selectedTagIds.filter((id) => id !== tagId)
        : [...selectedTagIds, tagId],
    );
  };
  return (
    <fieldset
      className={styles.picker}
      aria-label={t('{{value1}}条件', {
        value1: label,
      })}
    >
      <legend>
        {icon}
        <span>{label}</span>
        {selectedTagIds.length > 0 && <b>{selectedTagIds.length}</b>}
      </legend>
      <label className={styles.searchBox}>
        <IconSearch size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label={searchLabel}
          placeholder={t('搜索汉字、拼音或首字母')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {selectedTags.length > 0 && (
        <div
          className={styles.selectedTags}
          aria-label={t('已选{{value1}}', {
            value1: label,
          })}
        >
          {selectedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              aria-label={t('移除已选标签 {{value1}}', {
                value1: tag.name,
              })}
              onClick={() => toggleTag(tag.id)}
            >
              <span>{tag.name}</span>
              <IconX size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {visibleTags.length > 0 ? (
        <EagleVirtualList
          ariaLabel={t('{{value1}}列表', {
            value1: label,
          })}
          className={styles.tagList}
          items={visibleTags}
          itemKey={({ tag }) => tag.id}
          rowHeight={32}
          viewportHeight={160}
          renderItem={({ tag }) => (
            <label key={tag.id} className={styles.tagOption}>
              <input
                type="checkbox"
                aria-label={tag.name}
                checked={selectedTagIds.includes(tag.id)}
                onChange={() => toggleTag(tag.id)}
              />
              {tag.color !== undefined && (
                <span
                  className={styles.color}
                  style={tag.color ? { background: tag.color } : undefined}
                />
              )}
              <span className={styles.tagName}>{tag.name}</span>
              {tag.isStarred && (
                <IconStarFilled className={styles.star} size={12} aria-label={t('星标')} />
              )}
              <small>{tag.assetCount}</small>
            </label>
          )}
        />
      ) : (
        <div className={`${styles.tagList} ${styles.empty}`}>
          {tags.length > 0 ? t('没有匹配的标签') : emptyText}
        </div>
      )}
    </fieldset>
  );
}
