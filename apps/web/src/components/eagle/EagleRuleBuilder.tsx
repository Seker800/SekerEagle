import { useMemo, useState } from 'react';
import { IconMinus, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import {
  EAGLE_FILTER_FIELDS,
  EAGLE_FILTER_MAX_CONDITIONS,
  EAGLE_FILTER_MAX_RULES_PER_CONDITION,
  EAGLE_FILTER_OPERATOR_LABELS,
  createEagleFilterCondition,
  createEagleFilterRule,
  getEagleFilterFieldDefinition,
  type EagleFilterCondition,
  type EagleFilterField,
  type EagleFilterQuery,
  type EagleFilterRule,
} from '@sekereagle/eagle-filter-core';
import type { EagleAiTag, EagleManualTag } from '../../lib/eagle-api';
import { searchAndSortEagleTags } from './eagle-tag-index';
import styles from './EagleRuleBuilder.module.css';

interface EagleRuleBuilderProps {
  value: EagleFilterQuery;
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  onChange: (value: EagleFilterQuery) => void;
}

export function EagleRuleBuilder({ value, manualTags, aiTags, onChange }: EagleRuleBuilderProps) {
  const replaceCondition = (conditionId: string, next: EagleFilterCondition) =>
    onChange({
      ...value,
      conditions: value.conditions.map((condition) =>
        condition.id === conditionId ? next : condition,
      ),
    });

  const insertCondition = (index: number) => {
    if (value.conditions.length >= EAGLE_FILTER_MAX_CONDITIONS) return;
    const conditions = [...value.conditions];
    conditions.splice(index + 1, 0, createEagleFilterCondition());
    onChange({ ...value, conditions });
  };

  const removeCondition = (conditionId: string) => {
    const conditions = value.conditions.filter((condition) => condition.id !== conditionId);
    onChange({ ...value, conditions });
  };

  const addFirstCondition = () => {
    const condition = createEagleFilterCondition();
    onChange({
      ...value,
      conditions: [
        {
          ...condition,
          rules: [createEagleFilterRule('MANUAL_TAGS')],
        },
      ],
    });
  };

  return (
    <div className={styles.builder} aria-label="筛选规则编辑器">
      {value.conditions.length === 0 ? (
        <button
          className={styles.addFirstCondition}
          type="button"
          aria-label="添加筛选条件"
          onClick={addFirstCondition}
        >
          <IconPlus size={17} />
          添加筛选条件
        </button>
      ) : null}
      {value.conditions.map((condition, conditionIndex) => (
        <section
          className={styles.condition}
          key={condition.id}
          aria-label={`条件组 ${conditionIndex + 1}`}
        >
          <header className={styles.conditionHeader}>
            <div className={styles.conditionSentence}>
              {conditionIndex > 0 ? <span>并且</span> : null}
              <select
                aria-label={`条件组 ${conditionIndex + 1} 匹配方式`}
                value={condition.match}
                onChange={(event) =>
                  replaceCondition(condition.id, {
                    ...condition,
                    match: event.target.value as EagleFilterCondition['match'],
                  })
                }
              >
                <option value="ANY">任一项</option>
                <option value="ALL">全部</option>
              </select>
              <span>条件</span>
              <select
                aria-label={`条件组 ${conditionIndex + 1} 结果方式`}
                value={condition.result}
                onChange={(event) =>
                  replaceCondition(condition.id, {
                    ...condition,
                    result: event.target.value as EagleFilterCondition['result'],
                  })
                }
              >
                <option value="MATCH">满足</option>
                <option value="NOT_MATCH">不满足</option>
              </select>
            </div>
            <div className={styles.conditionActions}>
              <button
                type="button"
                aria-label={`删除条件组 ${conditionIndex + 1}`}
                onClick={() => removeCondition(condition.id)}
              >
                <IconMinus size={17} />
              </button>
              <button
                type="button"
                aria-label={`在条件组 ${conditionIndex + 1} 后添加条件组`}
                disabled={value.conditions.length >= EAGLE_FILTER_MAX_CONDITIONS}
                onClick={() => insertCondition(conditionIndex)}
              >
                <IconPlus size={17} />
              </button>
            </div>
          </header>
          <div className={styles.rules}>
            {condition.rules.map((rule, ruleIndex) => (
              <RuleRow
                key={rule.id}
                condition={condition}
                rule={rule}
                ruleIndex={ruleIndex}
                manualTags={manualTags}
                aiTags={aiTags}
                onChange={(nextRule) =>
                  replaceCondition(condition.id, {
                    ...condition,
                    rules: condition.rules.map((candidate) =>
                      candidate.id === rule.id ? nextRule : candidate,
                    ),
                  })
                }
                onAdd={() => {
                  if (condition.rules.length >= EAGLE_FILTER_MAX_RULES_PER_CONDITION) return;
                  const rules = [...condition.rules];
                  rules.splice(ruleIndex + 1, 0, createEagleFilterRule());
                  replaceCondition(condition.id, { ...condition, rules });
                }}
                onRemove={() => {
                  const rules = condition.rules.filter((candidate) => candidate.id !== rule.id);
                  if (rules.length) replaceCondition(condition.id, { ...condition, rules });
                  else removeCondition(condition.id);
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface RuleRowProps {
  condition: EagleFilterCondition;
  rule: EagleFilterRule;
  ruleIndex: number;
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  onChange: (value: EagleFilterRule) => void;
  onAdd: () => void;
  onRemove: () => void;
}

function RuleRow({
  condition,
  rule,
  ruleIndex,
  manualTags,
  aiTags,
  onChange,
  onAdd,
  onRemove,
}: RuleRowProps) {
  const definition = getEagleFilterFieldDefinition(rule.field);
  const hideValue = rule.operator === 'EMPTY' || rule.operator === 'NOT_EMPTY';
  const changeField = (field: EagleFilterField) => onChange(createEagleFilterRule(field, rule.id));

  return (
    <div className={styles.rule} aria-label={`规则 ${ruleIndex + 1}`}>
      <select
        className={styles.fieldSelect}
        aria-label={`规则 ${ruleIndex + 1} 字段`}
        value={rule.field}
        onChange={(event) => changeField(event.target.value as EagleFilterField)}
      >
        {EAGLE_FILTER_FIELDS.map((field) => (
          <option key={field.field} value={field.field}>
            {field.label}
          </option>
        ))}
      </select>
      <select
        className={styles.operatorSelect}
        aria-label={`规则 ${ruleIndex + 1} 运算符`}
        value={rule.operator}
        onChange={(event) =>
          onChange(changeRuleOperator(rule, event.target.value as EagleFilterRule['operator']))
        }
      >
        {definition.operators.map((operator) => (
          <option key={operator} value={operator}>
            {EAGLE_FILTER_OPERATOR_LABELS[operator]}
          </option>
        ))}
      </select>
      <div className={styles.valueCell}>
        {!hideValue && (
          <RuleValue rule={rule} manualTags={manualTags} aiTags={aiTags} onChange={onChange} />
        )}
      </div>
      <div className={styles.ruleActions}>
        <button type="button" aria-label={`删除规则 ${ruleIndex + 1}`} onClick={onRemove}>
          <IconMinus size={17} />
        </button>
        <button
          type="button"
          aria-label={`在规则 ${ruleIndex + 1} 后添加规则`}
          disabled={condition.rules.length >= EAGLE_FILTER_MAX_RULES_PER_CONDITION}
          onClick={onAdd}
        >
          <IconPlus size={17} />
        </button>
      </div>
    </div>
  );
}

function changeRuleOperator(
  rule: EagleFilterRule,
  operator: EagleFilterRule['operator'],
): EagleFilterRule {
  if (operator === 'BETWEEN' && !Array.isArray(rule.value)) {
    const value =
      rule.value ?? (getEagleFilterFieldDefinition(rule.field).kind === 'DATE' ? '' : 0);
    return { ...rule, operator, value: [value, value] as EagleFilterRule['value'] };
  }
  if (
    operator !== 'BETWEEN' &&
    Array.isArray(rule.value) &&
    rule.field !== 'MANUAL_TAGS' &&
    rule.field !== 'AI_TAGS'
  ) {
    return { ...rule, operator, value: rule.value[0] };
  }
  return { ...rule, operator };
}

function RuleValue({
  rule,
  manualTags,
  aiTags,
  onChange,
}: {
  rule: EagleFilterRule;
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  onChange: (value: EagleFilterRule) => void;
}) {
  const definition = getEagleFilterFieldDefinition(rule.field);
  if (definition.kind === 'TAGS') {
    return (
      <RuleTagPicker
        label={definition.label}
        tags={rule.field === 'MANUAL_TAGS' ? manualTags : aiTags}
        value={Array.isArray(rule.value) ? (rule.value as string[]) : []}
        onChange={(value) => onChange({ ...rule, value })}
      />
    );
  }
  if (definition.kind === 'SELECT') {
    return (
      <select
        aria-label={`${definition.label}值`}
        value={String(rule.value ?? definition.options?.[0]?.value ?? '')}
        onChange={(event) => onChange({ ...rule, value: event.target.value })}
      >
        {definition.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (definition.kind === 'COLOR') {
    const value = typeof rule.value === 'string' ? rule.value : '#2e86ab';
    return (
      <label className={styles.colorValue}>
        <input
          type="color"
          aria-label="筛选颜色"
          value={value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        />
        <input
          type="text"
          aria-label="筛选颜色值"
          maxLength={7}
          value={value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
        />
      </label>
    );
  }
  if (definition.kind === 'NUMBER' || rule.operator === 'WITHIN_DAYS') {
    return (
      <NumberRuleValue
        rule={rule}
        showUnit={definition.kind === 'NUMBER' && Boolean(definition.units)}
        onChange={onChange}
      />
    );
  }
  if (definition.kind === 'DATE') {
    const values = Array.isArray(rule.value) ? rule.value : [rule.value ?? ''];
    return (
      <div className={styles.betweenValue}>
        <input
          type="date"
          aria-label={`${definition.label}起始值`}
          value={String(values[0] ?? '').slice(0, 10)}
          onChange={(event) =>
            onChange({
              ...rule,
              value:
                rule.operator === 'BETWEEN'
                  ? [event.target.value, String(values[1] ?? '')]
                  : event.target.value,
            })
          }
        />
        {rule.operator === 'BETWEEN' && (
          <>
            <span>—</span>
            <input
              type="date"
              aria-label={`${definition.label}结束值`}
              value={String(values[1] ?? '').slice(0, 10)}
              onChange={(event) =>
                onChange({ ...rule, value: [String(values[0] ?? ''), event.target.value] })
              }
            />
          </>
        )}
      </div>
    );
  }
  return (
    <input
      type="text"
      aria-label={`${definition.label}值`}
      value={typeof rule.value === 'string' ? rule.value : ''}
      onChange={(event) => onChange({ ...rule, value: event.target.value })}
    />
  );
}

function NumberRuleValue({
  rule,
  showUnit,
  onChange,
}: {
  rule: EagleFilterRule;
  showUnit: boolean;
  onChange: (value: EagleFilterRule) => void;
}) {
  const definition = getEagleFilterFieldDefinition(rule.field);
  const values = Array.isArray(rule.value) ? rule.value : [rule.value ?? 0];
  const update = (index: number, input: string) => {
    const parsed = input === '' ? 0 : Number(input);
    const next = [...values];
    next[index] = parsed;
    onChange({ ...rule, value: rule.operator === 'BETWEEN' ? (next as [number, number]) : parsed });
  };
  return (
    <div className={styles.numberValue}>
      <input
        type="number"
        min="0"
        aria-label={`${definition.label}数值`}
        value={Number(values[0] ?? 0)}
        onChange={(event) => update(0, event.target.value)}
      />
      {rule.operator === 'BETWEEN' && (
        <>
          <span>—</span>
          <input
            type="number"
            min="0"
            aria-label={`${definition.label}结束数值`}
            value={Number(values[1] ?? 0)}
            onChange={(event) => update(1, event.target.value)}
          />
        </>
      )}
      {showUnit && (
        <select
          aria-label={`${definition.label}单位`}
          value={rule.unit ?? definition.units?.[0]?.value}
          onChange={(event) =>
            onChange({ ...rule, unit: event.target.value as NonNullable<EagleFilterRule['unit']> })
          }
        >
          {definition.units?.map((unit) => (
            <option key={unit.value} value={unit.value}>
              {unit.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

type RuleTag = EagleManualTag | EagleAiTag;

function RuleTagPicker({
  label,
  tags,
  value,
  onChange,
}: {
  label: string;
  tags: RuleTag[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const visibleTags = useMemo(
    () =>
      searchAndSortEagleTags(tags, search, value)
        .slice(0, 100)
        .map(({ tag }) => tag),
    [search, tags, value],
  );
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((candidate) => candidate !== id) : [...value, id]);

  return (
    <details className={styles.tagPicker}>
      <summary aria-label={`选择${label}`}>
        {value.length ? (
          <span className={styles.tagTokens}>
            {value.slice(0, 3).map((id) => (
              <span key={id}>{tagsById.get(id)?.name ?? '未知标签'}</span>
            ))}
            {value.length > 3 && <span>+{value.length - 3}</span>}
          </span>
        ) : (
          <span className={styles.tagPlaceholder}>选择{label}…</span>
        )}
      </summary>
      <div className={styles.tagMenu}>
        <label className={styles.tagSearch}>
          <IconSearch size={14} />
          <input
            type="search"
            aria-label={`搜索${label}`}
            placeholder="搜索…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button type="button" aria-label={`清除${label}搜索`} onClick={() => setSearch('')}>
              <IconX size={13} />
            </button>
          )}
        </label>
        <div className={styles.tagOptions}>
          {visibleTags.map((tag) => (
            <label key={tag.id}>
              <input
                type="checkbox"
                checked={value.includes(tag.id)}
                onChange={() => toggle(tag.id)}
              />
              <span>{tag.name}</span>
              <small>{tag.assetCount}</small>
            </label>
          ))}
          {!visibleTags.length && <p>没有匹配标签</p>}
        </div>
      </div>
    </details>
  );
}
