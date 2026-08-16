import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { IconPlus, IconSearch, IconTags, IconX } from '@tabler/icons-react';
import type { EagleManualTag } from '../../lib/eagle-api';
import { searchAndSortEagleTags } from './eagle-tag-index';
import { EagleVirtualList } from './EagleVirtualList';
import styles from './EagleBatchTagPicker.module.css';

interface EagleBatchTagPickerProps {
  assetCount: number;
  tags: EagleManualTag[];
  pending?: boolean;
  error?: string;
  onApply: (tagIds: string[]) => void;
  onCreate?: (name: string) => Promise<EagleManualTag>;
  onClose: () => void;
}

export function EagleBatchTagPicker({
  assetCount,
  tags,
  pending = false,
  error,
  onApply,
  onCreate,
  onClose,
}: EagleBatchTagPickerProps) {
  const [query, setQuery] = useState('');
  const [createdTags, setCreatedTags] = useState<EagleManualTag[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const allTags = useMemo(() => {
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    createdTags.forEach((tag) => tagsById.set(tag.id, tag));
    return [...tagsById.values()];
  }, [createdTags, tags]);
  const visibleTags = useMemo(
    () => searchAndSortEagleTags(allTags, query, selectedTagIds),
    [allTags, query, selectedTagIds],
  );
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLocaleLowerCase('zh-CN');
  const canCreate = Boolean(
    onCreate &&
    trimmedQuery &&
    visibleTags.length === 0 &&
    trimmedQuery.length <= 64 &&
    !allTags.some((tag) => tag.name.trim().toLocaleLowerCase('zh-CN') === normalizedQuery),
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selectedTagIds.length > 0) onApply(selectedTagIds);
  };

  const createTag = async () => {
    if (!onCreate || !canCreate) return;
    setIsCreating(true);
    try {
      const tag = await onCreate(trimmedQuery);
      setCreatedTags((current) => [...current, tag]);
      setSelectedTagIds((current) => (current.includes(tag.id) ? current : [...current, tag.id]));
      setQuery(tag.name);
    } catch {
      // The parent mutation exposes the API error through the dialog's error prop.
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="添加标签"
        onSubmit={submit}
      >
        <header>
          <div>
            <IconTags size={19} />
            <h2>添加标签</h2>
            <span>{assetCount} 项素材</span>
          </div>
          <button type="button" aria-label="关闭标签选择" onClick={onClose}>
            <IconX size={18} />
          </button>
        </header>
        <label className={styles.searchBox}>
          <IconSearch size={16} aria-hidden="true" />
          <input
            autoFocus
            type="search"
            aria-label="搜索可添加标签"
            placeholder="搜索名称、拼音或首字母"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={styles.tagList}>
          {canCreate && (
            <button
              className={styles.createTag}
              type="button"
              aria-label={`创建标签 ${trimmedQuery}`}
              disabled={isCreating || pending}
              onClick={() => void createTag()}
            >
              <IconPlus size={15} />
              创建“{trimmedQuery}”
            </button>
          )}
          {visibleTags.length > 0 ? (
            <EagleVirtualList
              ariaLabel="可添加标签"
              className={styles.virtualTagList}
              items={visibleTags}
              itemKey={({ tag }) => tag.id}
              rowHeight={37}
              viewportHeight={420}
              renderItem={({ tag }) => (
              <label key={tag.id} className={styles.tagOption}>
                <input
                  type="checkbox"
                  aria-label={tag.name}
                  checked={selectedTagIds.includes(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                />
                <span
                  className={styles.color}
                  style={tag.color ? { background: tag.color } : undefined}
                />
                <span>{tag.name}</span>
                <small>{tag.assetCount}</small>
              </label>
              )}
            />
          ) : (
            <div className={styles.empty} aria-label="可添加标签">
              没有匹配的标签
            </div>
          )}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <footer>
          <span>
            {selectedTagIds.length > 0
              ? `已选择 ${selectedTagIds.length} 个标签`
              : '选择一个或多个标签'}
          </span>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            className={styles.primary}
            type="submit"
            aria-label={`添加 ${selectedTagIds.length} 个标签到 ${assetCount} 项素材`}
            disabled={selectedTagIds.length === 0 || pending || isCreating}
          >
            添加
          </button>
        </footer>
      </form>
    </div>
  );
}
