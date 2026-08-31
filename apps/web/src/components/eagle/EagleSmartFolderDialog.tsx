import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconFolderBolt, IconX } from '@tabler/icons-react';
import {
  countActiveEagleFilterRules,
  createEmptyEagleFilterQuery,
  createEagleFilterRule,
  type EagleFilterQuery,
} from '@sekereagle/eagle-filter-core';
import type { EagleAiTag, EagleManualTag } from '../../lib/eagle-api';
import { countEagleAssets } from '../../lib/eagle-api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { EagleRuleBuilder } from './EagleRuleBuilder';
import styles from './EagleSmartFolderDialog.module.css';
interface EagleSmartFolderDialogProps {
  accessToken?: string;
  initialQuery: EagleFilterQuery;
  initialName?: string;
  mode?: 'create' | 'edit';
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  pending?: boolean;
  error?: string;
  onClose: () => void;
  onSave: (input: { name: string; query: EagleFilterQuery }) => void;
}
function createEditableQuery(query: EagleFilterQuery): EagleFilterQuery {
  if (countActiveEagleFilterRules(query) > 0) return query;
  const emptyQuery = createEmptyEagleFilterQuery();
  return {
    ...emptyQuery,
    conditions: emptyQuery.conditions.map((condition) => ({
      ...condition,
      rules: [createEagleFilterRule('MANUAL_TAGS')],
    })),
  };
}
export function EagleSmartFolderDialog({
  accessToken = '',
  initialQuery,
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
  const [query, setQuery] = useState(() => createEditableQuery(initialQuery));
  const deferredQuery = useDebouncedValue(query, 250);
  const activeConditionCount = countActiveEagleFilterRules(query);
  const hasActiveDeferredCondition = countActiveEagleFilterRules(deferredQuery) > 0;
  const countQuery = useQuery({
    queryKey: ['eagle', 'smart-folder-preview', deferredQuery],
    queryFn: () => countEagleAssets(accessToken, deferredQuery),
    enabled: hasActiveDeferredCondition,
    staleTime: 10000,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = name.normalize('NFKC').trim();
    if (!normalized) return;
    onSave({ name: normalized, query });
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
                {mode === 'edit' ? t('修改规则') : t('新建智能文件夹')}
              </h2>
              <p id="smart-folder-description">{t('符合规则的素材会自动出现在这个智能文件夹中')}</p>
            </div>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label={t('关闭智能文件夹窗口')}
            onClick={onClose}
          >
            <IconX size={19} />
          </button>
        </header>
        <div className={styles.body}>
          <label className={styles.nameField}>
            <span>{t('智能文件夹名称')}</span>
            <input
              autoFocus
              aria-label={t('智能文件夹名称')}
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <p className={styles.explainer}>
            {' ' + t('智能文件夹会依据筛选条件，自动把符合条件的素材显示在一起。') + ' '}
          </p>
          <EagleRuleBuilder
            value={query}
            manualTags={manualTags}
            aiTags={aiTags}
            onChange={setQuery}
          />
          {error && <p className={styles.error}>{error}</p>}
        </div>
        <footer>
          <span className={styles.conditionSummary} role="status" aria-live="polite">
            {activeConditionCount === 0
              ? t('找到 0 项符合规则的素材')
              : countQuery.isLoading
                ? t('正在计算符合规则的素材…')
                : countQuery.isError
                  ? t('已启用 {{value1}} 条规则', {
                      value1: activeConditionCount,
                    })
                  : t('找到 {{value1}} 项符合规则的素材', {
                      value1: countQuery.data?.count ?? 0,
                    })}
          </span>
          <div className={styles.footerActions}>
            <button type="button" onClick={onClose}>
              {' ' + t('取消') + ' '}
            </button>
            <button
              className={styles.primary}
              type="submit"
              aria-label={t('保存智能文件夹')}
              disabled={!name.trim() || pending}
            >
              {' ' + t('保存设置') + ' '}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
