import { useState, type FormEvent } from 'react';
import { IconFolderBolt, IconSparkles, IconTags, IconX } from '@tabler/icons-react';
import type { EagleAiTag, EagleManualTag, EagleSmartFolderFilters } from '../../lib/eagle-api';
import { EagleColorFilter } from './EagleColorFilter';
import { EagleTagConditionPicker } from './EagleTagConditionPicker';
import styles from './EagleSmartFolderDialog.module.css';

interface EagleSmartFolderDialogProps {
  initialFilters: EagleSmartFolderFilters;
  initialName?: string;
  mode?: 'create' | 'edit';
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  pending?: boolean;
  error?: string;
  onClose: () => void;
  onSave: (input: EagleSmartFolderFilters & { name: string }) => void;
}

export function EagleSmartFolderDialog({
  initialFilters,
  initialName = '',
  mode = 'create',
  manualTags,
  aiTags,
  pending,
  error,
  onClose,
  onSave,
}: EagleSmartFolderDialogProps) {
  const [name, setName] = useState(initialName);
  const [manualTagIds, setManualTagIds] = useState(initialFilters.manualTagIds ?? []);
  const [aiTagIds, setAiTagIds] = useState(initialFilters.aiTagIds ?? []);
  const [tagMatch, setTagMatch] = useState<'ANY' | 'ALL'>(
    initialFilters.tagMatch ?? (mode === 'create' ? 'ANY' : 'ALL'),
  );
  const [formats, setFormats] = useState(initialFilters.formats ?? []);
  const [rating, setRating] = useState(initialFilters.rating);
  const [assetColor, setAssetColor] = useState(initialFilters.assetColor);
  const activeConditionCount =
    manualTagIds.length +
    aiTagIds.length +
    formats.length +
    (rating ? 1 : 0) +
    (assetColor ? 1 : 0);

  const toggle = (id: string, current: string[], setCurrent: (value: string[]) => void) => {
    setCurrent(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = name.normalize('NFKC').trim();
    if (!normalized) return;
    onSave({
      ...initialFilters,
      name: normalized,
      manualTagIds,
      aiTagIds,
      tagMatch,
      formats,
      rating,
      assetColor,
    });
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
        aria-labelledby="smart-folder-title"
        aria-describedby="smart-folder-description"
        onSubmit={submit}
      >
        <header>
          <div className={styles.headerIdentity}>
            <span className={styles.headerIcon}>
              <IconFolderBolt size={19} />
            </span>
            <div className={styles.headerCopy}>
              <h2 id="smart-folder-title">
                {mode === 'edit' ? '修改智能文件夹' : '新建智能文件夹'}
              </h2>
              <p id="smart-folder-description">设置条件后，匹配的素材会自动归入这个文件夹</p>
            </div>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="关闭智能文件夹窗口"
            onClick={onClose}
          >
            <IconX size={18} />
          </button>
        </header>
        <div className={styles.body}>
          <div className={styles.layout}>
            <section className={styles.primaryPanel} aria-label="核心筛选条件">
              <label className={styles.nameField}>
                <span>文件夹名称</span>
                <input
                  autoFocus
                  aria-label="智能文件夹名称"
                  maxLength={64}
                  placeholder="例如：猫头鹰精选"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <div className={styles.sectionHeading}>
                <div>
                  <h3>标签条件</h3>
                  <p>选择一个或多个标签，设置它们之间的匹配关系</p>
                </div>
                <label className={styles.matchModeField}>
                  <span>已选标签</span>
                  <select
                    aria-label="标签匹配方式"
                    value={tagMatch}
                    onChange={(event) => setTagMatch(event.target.value as 'ANY' | 'ALL')}
                  >
                    <option value="ANY">任意包含</option>
                    <option value="ALL">同时包含</option>
                  </select>
                </label>
              </div>

              <div className={styles.tagPickers}>
                <EagleTagConditionPicker
                  label="人工标签"
                  icon={<IconTags size={14} />}
                  tags={manualTags}
                  selectedTagIds={manualTagIds}
                  emptyText="暂无人工标签"
                  onChange={setManualTagIds}
                />
                <EagleTagConditionPicker
                  label="AI 自动标签"
                  icon={<IconSparkles size={14} />}
                  tags={aiTags}
                  selectedTagIds={aiTagIds}
                  emptyText="AI 分析尚未启用"
                  onChange={setAiTagIds}
                />
              </div>
            </section>

            <section className={styles.secondaryPanel} aria-label="其他筛选条件">
              <div className={styles.sectionHeading}>
                <div>
                  <h3>其他条件</h3>
                  <p>需要时再进一步限定素材</p>
                </div>
                <span className={styles.optionalBadge}>可选</span>
              </div>

              <fieldset className={styles.secondaryGroup} aria-label="格式条件">
                <legend>文件格式</legend>
                <div className={styles.choices}>
                  {['jpeg', 'png', 'webp', 'gif', 'mp4'].map((format) => (
                    <label key={format}>
                      <input
                        type="checkbox"
                        checked={formats.includes(format)}
                        onChange={() => toggle(format, formats, setFormats)}
                      />
                      {format.toUpperCase()}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className={`${styles.ratingField} ${styles.secondaryGroup}`}>
                <span>最低星级</span>
                <select
                  aria-label="智能文件夹星级"
                  value={rating ?? ''}
                  onChange={(event) =>
                    setRating(event.target.value ? Number(event.target.value) : undefined)
                  }
                >
                  <option value="">不限</option>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value} 星
                    </option>
                  ))}
                </select>
              </label>

              <fieldset
                className={`${styles.secondaryGroup} ${styles.colorGroup}`}
                aria-label="相似颜色条件"
              >
                <legend>相似颜色</legend>
                <EagleColorFilter value={assetColor} onChange={setAssetColor} />
              </fieldset>
            </section>
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </div>
        <footer>
          <span className={styles.conditionSummary} role="status" aria-live="polite">
            {activeConditionCount > 0
              ? `已启用 ${activeConditionCount} 个条件`
              : '尚未添加筛选条件'}
          </span>
          <div className={styles.footerActions}>
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              className={styles.primary}
              type="submit"
              aria-label="保存智能文件夹"
              disabled={!name.trim() || pending}
            >
              保存
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
