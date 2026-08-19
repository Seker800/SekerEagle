import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  IconAspectRatio,
  IconCalendar,
  IconClock,
  IconFile,
  IconFileDescription,
  IconGripVertical,
  IconLink,
  IconPalette,
  IconPhoto,
  IconPin,
  IconPinnedOff,
  IconPlus,
  IconRulerMeasure,
  IconSearch,
  IconSparkles,
  IconStar,
  IconTags,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import type { EagleAiTag, EagleManualTag } from '../../lib/eagle-api';
import { searchAndSortEagleTags } from './eagle-tag-index';
import {
  DEFAULT_EAGLE_QUICK_FILTER_FIELDS,
  EAGLE_QUICK_FILTER_FIELDS,
  EAGLE_QUICK_FILTER_FIELD_LABELS,
  buildEagleQuickFilterQuery,
  clearEagleQuickFilter,
  countActiveEagleQuickFilters,
  createEmptyEagleQuickFilterState,
  isEagleQuickFilterActive,
  summarizeEagleQuickFilter,
  type EagleQuickDateField,
  type EagleQuickFilterField,
  type EagleQuickFilterState,
  type EagleQuickRangeField,
  type EagleQuickTextField,
} from './eagle-quick-filter-state';
import styles from './EagleQuickFilterBar.module.css';

export {
  buildEagleQuickFilterQuery,
  countActiveEagleQuickFilters,
  createEmptyEagleQuickFilterState,
};
export type { EagleQuickFilterState };

interface EagleQuickFilterBarProps {
  value: EagleQuickFilterState;
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  onChange: (value: EagleQuickFilterState) => void;
}

const QUICK_FILTER_FIELDS_KEY = 'seker-eagle.quick-filter-fields.v1';
const FORMAT_OPTIONS = ['png', 'jpeg', 'webp', 'gif', 'svg', 'pdf', 'mp4', 'mov', 'mp3', 'wav'];
const SHAPE_OPTIONS = [
  { value: 'LANDSCAPE', label: '横向' },
  { value: 'PORTRAIT', label: '纵向' },
  { value: 'SQUARE', label: '正方形' },
  { value: 'PANORAMA', label: '全景' },
];
const COLOR_OPTIONS = [
  '#2e86ab',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f5f5f4',
  '#78716c',
  '#171717',
];

const FIELD_ICONS: Record<EagleQuickFilterField, Icon> = {
  COLOR: IconPalette,
  MANUAL_TAGS: IconTags,
  AI_TAGS: IconSparkles,
  SHAPE: IconAspectRatio,
  RATING: IconStar,
  FORMAT: IconFile,
  WIDTH: IconRulerMeasure,
  HEIGHT: IconRulerMeasure,
  FILE_SIZE: IconFileDescription,
  DURATION: IconClock,
  NAME: IconPhoto,
  DESCRIPTION: IconFileDescription,
  SOURCE_URL: IconLink,
  ADDED_AT: IconCalendar,
  MODIFIED_AT: IconCalendar,
};

export function EagleQuickFilterBar({
  value,
  manualTags,
  aiTags,
  onChange,
}: EagleQuickFilterBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openField, setOpenField] = useState<EagleQuickFilterField | 'MANAGER' | null>(null);
  const [pinnedFields, setPinnedFields] = useState<EagleQuickFilterField[]>(readPinnedFields);
  const activeCount = countActiveEagleQuickFilters(value);
  const visibleFields = [
    ...pinnedFields,
    ...EAGLE_QUICK_FILTER_FIELDS.filter(
      (field) => !pinnedFields.includes(field) && isEagleQuickFilterActive(value, field),
    ),
  ];

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenField(null);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, []);

  const updatePinnedFields = (fields: EagleQuickFilterField[]) => {
    setPinnedFields(fields);
    window.localStorage.setItem(QUICK_FILTER_FIELDS_KEY, JSON.stringify(fields));
  };

  return (
    <div
      ref={rootRef}
      className={styles.root}
      role="toolbar"
      aria-label="快捷筛选"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpenField(null);
      }}
    >
      <div className={styles.fields}>
        {visibleFields.map((field) => {
          const label = EAGLE_QUICK_FILTER_FIELD_LABELS[field];
          const FieldIcon = FIELD_ICONS[field];
          const summary = summarizeEagleQuickFilter(value, field);
          const active = isEagleQuickFilterActive(value, field);
          return (
            <div className={styles.entry} key={field}>
              <button
                type="button"
                className={active ? styles.activeField : undefined}
                aria-label={`${label}筛选${summary ? `，${summary}` : ''}`}
                aria-expanded={openField === field}
                onClick={() => setOpenField((current) => (current === field ? null : field))}
              >
                {field === 'COLOR' && value.color ? (
                  <span className={styles.colorDot} style={{ background: value.color }} />
                ) : (
                  <FieldIcon size={18} aria-hidden="true" />
                )}
                <span>{label}</span>
                {summary ? <small>{summary}</small> : null}
              </button>
              {openField === field ? (
                <FieldPopover
                  field={field}
                  value={value}
                  manualTags={manualTags}
                  aiTags={aiTags}
                  onChange={onChange}
                  onClose={() => setOpenField(null)}
                />
              ) : null}
            </div>
          );
        })}

        <div className={styles.entry}>
          <button
            type="button"
            className={styles.addField}
            aria-label="添加筛选器"
            aria-expanded={openField === 'MANAGER'}
            onClick={() => setOpenField((current) => (current === 'MANAGER' ? null : 'MANAGER'))}
          >
            <IconPlus size={18} aria-hidden="true" />
          </button>
          {openField === 'MANAGER' ? (
            <FilterManager
              pinnedFields={pinnedFields}
              onChange={updatePinnedFields}
              onClose={() => setOpenField(null)}
            />
          ) : null}
        </div>
      </div>

      {activeCount ? (
        <button
          type="button"
          className={styles.clearAll}
          aria-label={`清除全部快捷筛选，共 ${activeCount} 项`}
          onClick={() => onChange(createEmptyEagleQuickFilterState())}
        >
          <IconX size={15} aria-hidden="true" />
          清除
        </button>
      ) : null}
    </div>
  );
}

function FieldPopover({
  field,
  value,
  manualTags,
  aiTags,
  onChange,
  onClose,
}: {
  field: EagleQuickFilterField;
  value: EagleQuickFilterState;
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  onChange: (value: EagleQuickFilterState) => void;
  onClose: () => void;
}) {
  const label = EAGLE_QUICK_FILTER_FIELD_LABELS[field];
  const active = isEagleQuickFilterActive(value, field);
  return (
    <div className={styles.popover} role="dialog" aria-label={`${label}筛选`}>
      <header>
        <strong>{label}</strong>
        <div>
          {active ? (
            <button type="button" onClick={() => onChange(clearEagleQuickFilter(value, field))}>
              清除此项
            </button>
          ) : null}
          <button type="button" aria-label={`关闭${label}筛选`} onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>
      </header>
      <div className={styles.popoverBody}>
        {renderFieldControl(field, value, manualTags, aiTags, onChange)}
      </div>
    </div>
  );
}

function renderFieldControl(
  field: EagleQuickFilterField,
  value: EagleQuickFilterState,
  manualTags: EagleManualTag[],
  aiTags: EagleAiTag[],
  onChange: (value: EagleQuickFilterState) => void,
) {
  switch (field) {
    case 'COLOR':
      return <ColorControl value={value} onChange={onChange} />;
    case 'MANUAL_TAGS':
      return (
        <TagControl
          kind="MANUAL"
          tags={manualTags}
          selectedIds={value.manualTagIds}
          match={value.manualTagMatch}
          onChange={(selectedIds, match) =>
            onChange({ ...value, manualTagIds: selectedIds, manualTagMatch: match })
          }
        />
      );
    case 'AI_TAGS':
      return (
        <TagControl
          kind="AI"
          tags={aiTags}
          selectedIds={value.aiTagIds}
          match={value.aiTagMatch}
          onChange={(selectedIds, match) =>
            onChange({ ...value, aiTagIds: selectedIds, aiTagMatch: match })
          }
        />
      );
    case 'FORMAT':
      return (
        <ChoiceControl
          options={FORMAT_OPTIONS.map((option) => ({ value: option, label: option.toUpperCase() }))}
          selected={value.formats}
          onChange={(formats) => onChange({ ...value, formats })}
        />
      );
    case 'SHAPE':
      return (
        <ChoiceControl
          options={SHAPE_OPTIONS}
          selected={value.shapes}
          onChange={(shapes) => onChange({ ...value, shapes })}
          visual
        />
      );
    case 'RATING':
      return <RatingControl value={value} onChange={onChange} />;
    case 'WIDTH':
    case 'HEIGHT':
    case 'FILE_SIZE':
    case 'DURATION':
      return <RangeControl field={field} value={value} onChange={onChange} />;
    case 'ADDED_AT':
    case 'MODIFIED_AT':
      return <DateControl field={field} value={value} onChange={onChange} />;
    case 'NAME':
    case 'DESCRIPTION':
    case 'SOURCE_URL':
      return <TextControl field={field} value={value} onChange={onChange} />;
  }
}

function ColorControl({
  value,
  onChange,
}: {
  value: EagleQuickFilterState;
  onChange: (value: EagleQuickFilterState) => void;
}) {
  return (
    <div className={styles.colorControl}>
      <div className={styles.colorChoices}>
        {COLOR_OPTIONS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`颜色 ${color}`}
            aria-pressed={value.color === color}
            style={{ background: color }}
            onClick={() => onChange({ ...value, color })}
          />
        ))}
      </div>
      <label>
        自定义颜色
        <input
          type="color"
          aria-label="自定义颜色"
          value={value.color ?? '#2e86ab'}
          onChange={(event) => onChange({ ...value, color: event.target.value })}
        />
      </label>
    </div>
  );
}

function TagControl({
  kind,
  tags,
  selectedIds,
  match,
  onChange,
}: {
  kind: 'MANUAL' | 'AI';
  tags: Array<EagleManualTag | EagleAiTag>;
  selectedIds: string[];
  match: 'ANY' | 'ALL';
  onChange: (selectedIds: string[], match: 'ANY' | 'ALL') => void;
}) {
  const [search, setSearch] = useState('');
  const visibleTags = useMemo(
    () =>
      searchAndSortEagleTags(tags, search, selectedIds)
        .slice(0, 100)
        .map(({ tag }) => tag),
    [search, selectedIds, tags],
  );
  const searchLabel = kind === 'MANUAL' ? '搜索标签' : '搜索 AI 标签';
  return (
    <div className={styles.tagControl}>
      <div className={styles.matchModes}>
        <label>
          <input
            type="radio"
            name={`${kind}-tag-match`}
            aria-label={kind === 'MANUAL' ? '匹配任一标签' : '匹配任一 AI 标签'}
            checked={match === 'ANY'}
            onChange={() => onChange(selectedIds, 'ANY')}
          />
          任一
        </label>
        <label>
          <input
            type="radio"
            name={`${kind}-tag-match`}
            aria-label={kind === 'MANUAL' ? '匹配全部标签' : '匹配全部 AI 标签'}
            checked={match === 'ALL'}
            onChange={() => onChange(selectedIds, 'ALL')}
          />
          全部
        </label>
      </div>
      <label className={styles.popoverSearch}>
        <IconSearch size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className={styles.tagList}>
        {visibleTags.map((tag) => (
          <label key={tag.id}>
            <input
              type="checkbox"
              checked={selectedIds.includes(tag.id)}
              onChange={() => onChange(toggleValue(selectedIds, tag.id), match)}
            />
            {'color' in tag && tag.color ? (
              <span className={styles.tagColor} style={{ background: tag.color }} />
            ) : null}
            <span>{tag.name}</span>
            <small>{tag.assetCount}</small>
          </label>
        ))}
        {!visibleTags.length ? <p>没有匹配的标签</p> : null}
      </div>
    </div>
  );
}

function ChoiceControl({
  options,
  selected,
  onChange,
  visual = false,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  visual?: boolean;
}) {
  return (
    <div className={visual ? styles.visualChoices : styles.choiceList}>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={() => onChange(toggleValue(selected, option.value))}
          />
          {visual ? <span className={styles[`shape${option.value}`]} aria-hidden="true" /> : null}
          {option.label}
        </label>
      ))}
    </div>
  );
}

function RatingControl({
  value,
  onChange,
}: {
  value: EagleQuickFilterState;
  onChange: (value: EagleQuickFilterState) => void;
}) {
  return (
    <div className={styles.ratingControl}>
      <span>至少</span>
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          key={rating}
          type="button"
          aria-label={`至少 ${rating} 星`}
          aria-pressed={value.ratingAtLeast === rating}
          onClick={() => onChange({ ...value, ratingAtLeast: rating })}
        >
          <IconStar
            size={22}
            fill={
              value.ratingAtLeast !== undefined && rating <= value.ratingAtLeast
                ? 'currentColor'
                : 'none'
            }
          />
        </button>
      ))}
    </div>
  );
}

function RangeControl({
  field,
  value,
  onChange,
}: {
  field: EagleQuickRangeField;
  value: EagleQuickFilterState;
  onChange: (value: EagleQuickFilterState) => void;
}) {
  const defaultUnit = field === 'FILE_SIZE' ? 'MB' : field === 'DURATION' ? 'SECONDS' : undefined;
  const range = value.ranges[field] ?? {
    min: '',
    max: '',
    ...(defaultUnit ? { unit: defaultUnit } : {}),
  };
  const update = (next: typeof range) =>
    onChange({ ...value, ranges: { ...value.ranges, [field]: next } });
  return (
    <div className={styles.rangeControl}>
      <label>
        最小值
        <input
          type="number"
          min="0"
          aria-label={`${EAGLE_QUICK_FILTER_FIELD_LABELS[field]}最小值`}
          value={range.min}
          onChange={(event) => update({ ...range, min: event.target.value })}
        />
      </label>
      <span>—</span>
      <label>
        最大值
        <input
          type="number"
          min="0"
          aria-label={`${EAGLE_QUICK_FILTER_FIELD_LABELS[field]}最大值`}
          value={range.max}
          onChange={(event) => update({ ...range, max: event.target.value })}
        />
      </label>
      {field === 'FILE_SIZE' || field === 'DURATION' ? (
        <select
          aria-label={`${EAGLE_QUICK_FILTER_FIELD_LABELS[field]}单位`}
          value={range.unit}
          onChange={(event) =>
            update({ ...range, unit: event.target.value as NonNullable<typeof range.unit> })
          }
        >
          {(field === 'FILE_SIZE'
            ? [
                ['KB', 'KB'],
                ['MB', 'MB'],
                ['GB', 'GB'],
              ]
            : [
                ['SECONDS', '秒'],
                ['MINUTES', '分钟'],
                ['HOURS', '小时'],
              ]
          ).map(([optionValue, label]) => (
            <option key={optionValue} value={optionValue}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <span className={styles.unit}>px</span>
      )}
    </div>
  );
}

function DateControl({
  field,
  value,
  onChange,
}: {
  field: EagleQuickDateField;
  value: EagleQuickFilterState;
  onChange: (value: EagleQuickFilterState) => void;
}) {
  const range = value.dates[field] ?? { from: '', to: '' };
  const update = (next: typeof range) =>
    onChange({ ...value, dates: { ...value.dates, [field]: next } });
  return (
    <div className={styles.dateControl}>
      <label>
        从
        <input
          type="date"
          aria-label={`${EAGLE_QUICK_FILTER_FIELD_LABELS[field]}开始`}
          value={range.from}
          onChange={(event) => update({ ...range, from: event.target.value })}
        />
      </label>
      <label>
        到
        <input
          type="date"
          aria-label={`${EAGLE_QUICK_FILTER_FIELD_LABELS[field]}结束`}
          value={range.to}
          onChange={(event) => update({ ...range, to: event.target.value })}
        />
      </label>
    </div>
  );
}

function TextControl({
  field,
  value,
  onChange,
}: {
  field: EagleQuickTextField;
  value: EagleQuickFilterState;
  onChange: (value: EagleQuickFilterState) => void;
}) {
  const label = EAGLE_QUICK_FILTER_FIELD_LABELS[field];
  return (
    <label className={styles.textControl}>
      <IconSearch size={16} aria-hidden="true" />
      <input
        autoFocus
        type="search"
        aria-label={`${label}包含`}
        placeholder={`输入${label}关键词`}
        value={value.text[field] ?? ''}
        onChange={(event) =>
          onChange({ ...value, text: { ...value.text, [field]: event.target.value } })
        }
      />
    </label>
  );
}

function FilterManager({
  pinnedFields,
  onChange,
  onClose,
}: {
  pinnedFields: EagleQuickFilterField[];
  onChange: (fields: EagleQuickFilterField[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [draggedField, setDraggedField] = useState<EagleQuickFilterField | null>(null);
  const normalizedSearch = search.normalize('NFKC').trim().toLocaleLowerCase();
  const fields = EAGLE_QUICK_FILTER_FIELDS.filter((field) =>
    EAGLE_QUICK_FILTER_FIELD_LABELS[field].toLocaleLowerCase().includes(normalizedSearch),
  );
  const togglePinned = (field: EagleQuickFilterField) => {
    onChange(
      pinnedFields.includes(field)
        ? pinnedFields.filter((entry) => entry !== field)
        : [...pinnedFields, field],
    );
  };
  const dropField = (target: EagleQuickFilterField) => {
    if (!draggedField || draggedField === target) return;
    const next = pinnedFields.filter((field) => field !== draggedField);
    const targetIndex = next.indexOf(target);
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggedField);
    onChange(next);
    setDraggedField(null);
  };
  return (
    <div
      className={`${styles.popover} ${styles.manager}`}
      role="dialog"
      aria-label="管理快捷筛选器"
    >
      <header>
        <strong>快捷筛选器</strong>
        <button type="button" aria-label="关闭筛选器管理" onClick={onClose}>
          <IconX size={15} />
        </button>
      </header>
      <label className={styles.popoverSearch}>
        <IconSearch size={15} aria-hidden="true" />
        <input
          autoFocus
          type="search"
          aria-label="搜索筛选器"
          placeholder="搜索…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className={styles.managerList}>
        {fields.map((field) => {
          const pinned = pinnedFields.includes(field);
          const FieldIcon = FIELD_ICONS[field];
          return (
            <div
              key={field}
              draggable={pinned}
              onDragStart={(event: DragEvent) => {
                event.dataTransfer.effectAllowed = 'move';
                setDraggedField(field);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropField(field)}
            >
              <IconGripVertical size={15} className={pinned ? undefined : styles.gripDisabled} />
              <FieldIcon size={18} />
              <span>{EAGLE_QUICK_FILTER_FIELD_LABELS[field]}</span>
              <button
                type="button"
                aria-label={`${pinned ? '取消固定' : '固定'} ${EAGLE_QUICK_FILTER_FIELD_LABELS[field]}`}
                aria-pressed={pinned}
                onClick={() => togglePinned(field)}
              >
                {pinned ? <IconPin size={17} /> : <IconPinnedOff size={17} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function readPinnedFields(): EagleQuickFilterField[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(QUICK_FILTER_FIELDS_KEY) ?? 'null',
    );
    if (!Array.isArray(parsed)) return [...DEFAULT_EAGLE_QUICK_FILTER_FIELDS];
    const valid = parsed.filter(
      (field): field is EagleQuickFilterField =>
        typeof field === 'string' &&
        EAGLE_QUICK_FILTER_FIELDS.includes(field as EagleQuickFilterField),
    );
    return [...new Set(valid)];
  } catch {
    return [...DEFAULT_EAGLE_QUICK_FILTER_FIELDS];
  }
}
