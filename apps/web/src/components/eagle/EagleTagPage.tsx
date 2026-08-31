import { t } from '../../i18n';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from 'react';
import {
  IconBookmark,
  IconCheck,
  IconChevronRight,
  IconEdit,
  IconLayoutGrid,
  IconList,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconTags,
  IconTrash,
} from '@tabler/icons-react';
import type { EagleAiTag, EagleManualTag, EagleManualTagGroup } from '../../lib/eagle-api';
import {
  compareEagleTagIndexes,
  compareEagleTagSections,
  createEagleTagIndex,
  eagleTagMatchesQuery,
} from './eagle-tag-index';
import styles from './EagleTagPage.module.css';
type TagScope = 'ALL' | 'UNCATEGORIZED' | 'STARRED' | 'USED' | 'UNUSED' | `GROUP:${string}`;
type SortMode = 'NAME_ASC' | 'COUNT_DESC' | 'COUNT_ASC';
type LayoutMode = 'GRID' | 'LIST';
export interface EagleManualTagChanges {
  name?: string;
  color?: string | null;
  groupId?: string | null;
  isStarred?: boolean;
}
interface EagleTagPageProps {
  kind: 'MANUAL' | 'AI';
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  manualTagGroups: EagleManualTagGroup[];
  creating?: boolean;
  busy?: boolean;
  error?: string;
  onCreateManualTag: (name: string) => void;
  onCreateManualTagGroup: (name: string) => void;
  onUpdateManualTags: (tags: EagleManualTag[], changes: EagleManualTagChanges) => void;
  onDeleteManualTags: (tags: EagleManualTag[]) => void;
  onUpdateManualTagGroup: (
    group: EagleManualTagGroup,
    changes: {
      name?: string;
      color?: string | null;
    },
  ) => void;
  onDeleteManualTagGroup: (group: EagleManualTagGroup) => void;
  onSelectTag: (tagId: string) => void;
}
export function EagleTagPage({
  kind,
  manualTags,
  aiTags,
  manualTagGroups,
  creating,
  busy,
  error,
  onCreateManualTag,
  onCreateManualTagGroup,
  onUpdateManualTags,
  onDeleteManualTags,
  onUpdateManualTagGroup,
  onDeleteManualTagGroup,
  onSelectTag,
}: EagleTagPageProps) {
  const isManual = kind === 'MANUAL';
  const allTags = isManual ? manualTags : aiTags;
  const [scope, setScope] = useState<TagScope>('ALL');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('NAME_ASC');
  const [layout, setLayout] = useState<LayoutMode>('GRID');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [showGroupCreator, setShowGroupCreator] = useState(false);
  const [editingTag, setEditingTag] = useState<EagleManualTag | null>(null);
  const [editingGroup, setEditingGroup] = useState<EagleManualTagGroup | null>(null);
  const [editName, setEditName] = useState('');
  const anchorIdRef = useRef<string | null>(null);
  useEffect(() => {
    setScope('ALL');
    setSelectedIds([]);
    anchorIdRef.current = null;
  }, [kind]);
  useEffect(() => {
    const validIds = new Set(allTags.map((tag) => tag.id));
    setSelectedIds((current) => current.filter((id) => validIds.has(id)));
  }, [allTags]);
  const tagIndexes = useMemo(
    () => new Map(allTags.map((tag) => [tag.id, createEagleTagIndex(tag)])),
    [allTags],
  );
  const visibleTags = useMemo(() => {
    const filtered = allTags.filter((tag) => {
      const index = tagIndexes.get(tag.id);
      if (!index || !eagleTagMatchesQuery(index, query)) return false;
      if (!isManual) {
        if (scope === 'USED') return tag.assetCount > 0;
        if (scope === 'UNUSED') return tag.assetCount === 0;
        return true;
      }
      const manualTag = tag as EagleManualTag;
      if (scope === 'UNCATEGORIZED') return manualTag.groupId === null;
      if (scope === 'STARRED') return manualTag.isStarred;
      if (scope.startsWith('GROUP:')) return manualTag.groupId === scope.slice(6);
      return true;
    });
    return filtered.sort((left, right) => {
      const leftIndex = tagIndexes.get(left.id)!;
      const rightIndex = tagIndexes.get(right.id)!;
      if (sort === 'COUNT_DESC')
        return right.assetCount - left.assetCount || compareEagleTagIndexes(leftIndex, rightIndex);
      if (sort === 'COUNT_ASC')
        return left.assetCount - right.assetCount || compareEagleTagIndexes(leftIndex, rightIndex);
      return compareEagleTagIndexes(leftIndex, rightIndex);
    });
  }, [allTags, isManual, query, scope, sort, tagIndexes]);
  const sections = useMemo(() => {
    if (sort !== 'NAME_ASC') return [[t('标签'), visibleTags]] as const;
    const grouped = new Map<string, typeof visibleTags>();
    visibleTags.forEach((tag) => {
      const key = tagIndexes.get(tag.id)?.section ?? t('其他');
      grouped.set(key, [...(grouped.get(key) ?? []), tag]);
    });
    return [...grouped.entries()].sort(([left], [right]) => compareEagleTagSections(left, right));
  }, [sort, tagIndexes, visibleTags]);
  const selectedManualTags = isManual
    ? manualTags.filter((tag) => selectedIds.includes(tag.id))
    : [];
  const activeGroup = scope.startsWith('GROUP:')
    ? (manualTagGroups.find((group) => group.id === scope.slice(6)) ?? null)
    : null;
  const changeScope = (nextScope: TagScope) => {
    setScope(nextScope);
    setSelectedIds([]);
    anchorIdRef.current = null;
  };
  const handleTagClick = (event: MouseEvent<HTMLButtonElement>, tagId: string) => {
    const visibleIds = visibleTags.map((tag) => tag.id);
    if (event.shiftKey && anchorIdRef.current) {
      const start = visibleIds.indexOf(anchorIdRef.current);
      const end = visibleIds.indexOf(tagId);
      if (start !== -1 && end !== -1) {
        setSelectedIds(visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedIds((current) =>
        current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
      );
    } else {
      setSelectedIds([tagId]);
    }
    anchorIdRef.current = tagId;
  };
  const submitTag = (event: FormEvent) => {
    event.preventDefault();
    const name = newTagName.normalize('NFKC').trim();
    if (!name) return;
    onCreateManualTag(name);
    setNewTagName('');
  };
  const submitGroup = (event: FormEvent) => {
    event.preventDefault();
    const name = newGroupName.normalize('NFKC').trim();
    if (!name) return;
    onCreateManualTagGroup(name);
    setNewGroupName('');
    setShowGroupCreator(false);
  };
  const startTagEdit = () => {
    const tag = selectedManualTags[0];
    if (!tag) return;
    setEditingTag(tag);
    setEditingGroup(null);
    setEditName(tag.name);
  };
  const startGroupEdit = () => {
    if (!activeGroup) return;
    setEditingGroup(activeGroup);
    setEditingTag(null);
    setEditName(activeGroup.name);
  };
  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    const name = editName.normalize('NFKC').trim();
    if (!name) return;
    if (editingTag) onUpdateManualTags([editingTag], { name });
    if (editingGroup) onUpdateManualTagGroup(editingGroup, { name });
    setEditingTag(null);
    setEditingGroup(null);
  };
  const deleteTags = () => {
    if (selectedManualTags.length === 0) return;
    const label =
      selectedManualTags.length === 1
        ? `“${selectedManualTags[0].name}”`
        : t('{{value1}} 个标签', {
            value1: selectedManualTags.length,
          });
    if (
      window.confirm(
        t('删除{{value1}}？素材本身不会被删除。', {
          value1: label,
        }),
      )
    )
      onDeleteManualTags(selectedManualTags);
  };
  const deleteGroup = () => {
    if (!activeGroup) return;
    if (
      window.confirm(
        t('删除标签组“{{value1}}”？组内标签会移到未分类。', {
          value1: activeGroup.name,
        }),
      )
    ) {
      onDeleteManualTagGroup(activeGroup);
      changeScope('UNCATEGORIZED');
    }
  };
  return (
    <section className={styles.page} aria-label={isManual ? t('人工标签管理') : t('AI 标签管理')}>
      <aside className={styles.scopePanel}>
        <div className={styles.scopeHeader}>
          <span>{isManual ? <IconTags size={16} /> : <IconSparkles size={16} />}</span>
          <strong>{isManual ? t('人工标签') : t('AI 自动标签')}</strong>
        </div>
        <nav aria-label={isManual ? t('人工标签导航') : t('AI 标签导航')}>
          <button
            type="button"
            className={scope === 'ALL' ? styles.scopeActive : undefined}
            onClick={() => changeScope('ALL')}
          >
            <IconBookmark size={15} />
            <span>{t('全部标签')}</span>
            <small>{allTags.length}</small>
          </button>
          {isManual ? (
            <>
              <button
                type="button"
                className={scope === 'UNCATEGORIZED' ? styles.scopeActive : undefined}
                onClick={() => changeScope('UNCATEGORIZED')}
              >
                <IconTags size={15} />
                <span>{t('未分类')}</span>
                <small>{manualTags.filter((tag) => tag.groupId === null).length}</small>
              </button>
              <button
                type="button"
                className={scope === 'STARRED' ? styles.scopeActive : undefined}
                onClick={() => changeScope('STARRED')}
              >
                <IconStar size={15} />
                <span>{t('常用标签')}</span>
                <small>{manualTags.filter((tag) => tag.isStarred).length}</small>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={scope === 'USED' ? styles.scopeActive : undefined}
                onClick={() => changeScope('USED')}
              >
                <IconCheck size={15} />
                <span>{t('已使用')}</span>
                <small>{aiTags.filter((tag) => tag.assetCount > 0).length}</small>
              </button>
              <button
                type="button"
                className={scope === 'UNUSED' ? styles.scopeActive : undefined}
                onClick={() => changeScope('UNUSED')}
              >
                <IconSparkles size={15} />
                <span>{t('未使用')}</span>
                <small>{aiTags.filter((tag) => tag.assetCount === 0).length}</small>
              </button>
            </>
          )}
        </nav>

        {isManual && (
          <div className={styles.groupSection}>
            <div className={styles.sectionLabel}>
              <span>{t('标签组')}</span>
              <button
                type="button"
                aria-label={t('新建标签组')}
                onClick={() => setShowGroupCreator((value) => !value)}
              >
                <IconPlus size={14} />
              </button>
            </div>
            {showGroupCreator && (
              <form className={styles.groupForm} onSubmit={submitGroup}>
                <input
                  autoFocus
                  aria-label={t('标签组名称')}
                  maxLength={64}
                  placeholder={t('新标签组')}
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                />
                <button type="submit" disabled={!newGroupName.trim() || busy}>
                  <IconCheck size={14} />
                </button>
              </form>
            )}
            <div className={styles.groupList}>
              {manualTagGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={scope === `GROUP:${group.id}` ? styles.scopeActive : undefined}
                  onClick={() => changeScope(`GROUP:${group.id}`)}
                >
                  <span
                    className={styles.groupDot}
                    style={{ '--tag-color': group.color ?? '#6d727a' } as CSSProperties}
                  />
                  <span>{group.name}</span>
                  <small>{group.tagCount}</small>
                </button>
              ))}
              {manualTagGroups.length === 0 && <p>{t('还没有标签组')}</p>}
            </div>
            {activeGroup && (
              <div className={styles.groupActions}>
                <button type="button" onClick={startGroupEdit}>
                  <IconEdit size={13} />
                  {' ' + t('重命名') + ' '}
                </button>
                <button type="button" onClick={deleteGroup}>
                  <IconTrash size={13} />
                  {' ' + t('删除') + ' '}
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      <div className={styles.directory}>
        <h1 id="eagle-library-title" className={styles.visuallyHidden}>
          {isManual ? t('人工标签') : t('AI 自动标签')}
        </h1>
        <header className={styles.toolbar}>
          <div className={styles.toolbarPrimary}>
            <strong>
              {scope === 'ALL'
                ? t('全部标签')
                : (activeGroup?.name ??
                  (
                    {
                      UNCATEGORIZED: t('未分类'),
                      STARRED: t('常用标签'),
                      USED: t('已使用'),
                      UNUSED: t('未使用'),
                    } as Record<string, string>
                  )[scope])}
            </strong>
            <span>{visibleTags.length}</span>
            {selectedIds.length > 0 && (
              <em>
                {t('已选择') + ' '}
                {selectedIds.length}
                {' ' + t('个')}
              </em>
            )}
          </div>
          <div className={styles.toolbarControls}>
            <label className={styles.searchBox}>
              <IconSearch size={15} />
              <input
                type="search"
                aria-label={t('搜索{{value1}}', {
                  value1: isManual ? t('人工标签') : t('AI标签'),
                })}
                placeholder={t('搜索标签')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label={t('标签排序')}
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
            >
              <option value="NAME_ASC">{t('按名称')}</option>
              <option value="COUNT_DESC">{t('使用数：高到低')}</option>
              <option value="COUNT_ASC">{t('使用数：低到高')}</option>
            </select>
            <div className={styles.layoutSwitch}>
              <button
                type="button"
                aria-label={t('网格视图')}
                aria-pressed={layout === 'GRID'}
                onClick={() => setLayout('GRID')}
              >
                <IconLayoutGrid size={16} />
              </button>
              <button
                type="button"
                aria-label={t('列表视图')}
                aria-pressed={layout === 'LIST'}
                onClick={() => setLayout('LIST')}
              >
                <IconList size={16} />
              </button>
            </div>
          </div>
        </header>

        {isManual && (
          <div className={styles.managementBar}>
            <form className={styles.createForm} onSubmit={submitTag}>
              <IconPlus size={15} />
              <input
                aria-label={t('新建人工标签')}
                maxLength={64}
                placeholder={t('新建标签')}
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
              />
              <button type="submit" disabled={!newTagName.trim() || creating || busy}>
                {' ' + t('创建') + ' '}
              </button>
            </form>
            {selectedManualTags.length > 0 && (
              <div className={styles.selectionActions}>
                <button
                  type="button"
                  aria-label={
                    selectedManualTags.every((tag) => tag.isStarred) ? t('取消常用') : t('设为常用')
                  }
                  onClick={() =>
                    onUpdateManualTags(selectedManualTags, {
                      isStarred: !selectedManualTags.every((tag) => tag.isStarred),
                    })
                  }
                >
                  {selectedManualTags.every((tag) => tag.isStarred) ? (
                    <IconStarFilled size={14} />
                  ) : (
                    <IconStar size={14} />
                  )}
                  {selectedManualTags.every((tag) => tag.isStarred) ? t('取消常用') : t('设为常用')}
                </button>
                <select
                  aria-label={t('移动到标签组')}
                  defaultValue=""
                  onChange={(event) => {
                    onUpdateManualTags(selectedManualTags, {
                      groupId: event.target.value === '__uncategorized' ? null : event.target.value,
                    });
                    event.target.value = '';
                  }}
                >
                  <option value="">{t('移动到标签组…')}</option>
                  <option value="__uncategorized">{t('未分类')}</option>
                  {manualTagGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                {selectedManualTags.length === 1 && (
                  <button type="button" onClick={startTagEdit}>
                    <IconEdit size={14} />
                    {' ' + t('重命名') + ' '}
                  </button>
                )}
                <button type="button" className={styles.danger} onClick={deleteTags}>
                  <IconTrash size={14} />
                  {' ' + t('删除') + ' '}
                </button>
              </div>
            )}
          </div>
        )}

        {(editingTag || editingGroup) && (
          <form className={styles.editBar} onSubmit={submitEdit}>
            <label>
              {editingTag ? t('重命名标签') : t('重命名标签组')}
              <input
                autoFocus
                maxLength={64}
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </label>
            <button type="submit" disabled={!editName.trim() || busy}>
              {' ' + t('保存') + ' '}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingTag(null);
                setEditingGroup(null);
              }}
            >
              {' ' + t('取消') + ' '}
            </button>
          </form>
        )}
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.catalog}>
          <ul
            className={styles.tagList}
            aria-label={t('{{value1}}目录', {
              value1: isManual ? t('人工标签') : t('AI标签'),
            })}
            data-layout={layout.toLowerCase()}
          >
            {sections.map(([sectionName, tags]) => (
              <li className={styles.catalogSection} key={sectionName}>
                <div className={styles.catalogHeading}>
                  <span>{sectionName}</span>
                  <small>{tags.length}</small>
                </div>
                <ul>
                  {tags.map((tag) => {
                    const manualTag = isManual ? (tag as EagleManualTag) : null;
                    const selected = selectedIds.includes(tag.id);
                    return (
                      <li key={tag.id}>
                        <button
                          type="button"
                          aria-label={t('{{value1}} {{value2}}，{{value3}} 项素材，双击查看', {
                            value1: isManual ? t('人工标签') : t('AI标签'),
                            value2: tag.name,
                            value3: tag.assetCount,
                          })}
                          aria-pressed={selected}
                          className={selected ? styles.tagSelected : undefined}
                          onClick={(event) => handleTagClick(event, tag.id)}
                          onDoubleClick={() => onSelectTag(tag.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') onSelectTag(tag.id);
                            if (event.key === 'Escape') setSelectedIds([]);
                          }}
                        >
                          <span
                            className={styles.tagBullet}
                            style={
                              {
                                '--tag-color':
                                  manualTag?.color ?? (isManual ? '#777b82' : '#c8755f'),
                              } as CSSProperties
                            }
                          />
                          <span className={styles.tagName}>{tag.name}</span>
                          {manualTag?.isStarred && (
                            <IconStarFilled className={styles.star} size={12} />
                          )}
                          <small>{tag.assetCount}</small>
                          <IconChevronRight className={styles.openHint} size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {visibleTags.length === 0 && (
            <div className={styles.empty}>
              {query
                ? t('没有匹配的标签')
                : isManual
                  ? t('这里还没有标签')
                  : t('AI 分析尚未生成标签')}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
