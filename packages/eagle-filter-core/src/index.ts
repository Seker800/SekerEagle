export const EAGLE_FILTER_QUERY_VERSION = 2 as const;
export const EAGLE_FILTER_MAX_CONDITIONS = 30;
export const EAGLE_FILTER_MAX_RULES_PER_CONDITION = 30;

export type EagleFilterField =
  | 'NAME'
  | 'FORMAT'
  | 'MANUAL_TAGS'
  | 'AI_TAGS'
  | 'RATING'
  | 'WIDTH'
  | 'HEIGHT'
  | 'FILE_SIZE'
  | 'DURATION'
  | 'SHAPE'
  | 'COLOR'
  | 'DESCRIPTION'
  | 'SOURCE_URL'
  | 'ADDED_AT'
  | 'MODIFIED_AT';

export type EagleFilterOperator =
  | 'CONTAINS'
  | 'NOT_CONTAINS'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'EMPTY'
  | 'NOT_EMPTY'
  | 'ANY_OF'
  | 'ALL_OF'
  | 'NONE_OF'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'BETWEEN'
  | 'BEFORE'
  | 'AFTER'
  | 'WITHIN_DAYS'
  | 'SIMILAR';

export type EagleFilterValue = string | string[] | number | [number, number];

export interface EagleFilterRule {
  id: string;
  field: EagleFilterField;
  operator: EagleFilterOperator;
  value?: EagleFilterValue;
  unit?: 'KB' | 'MB' | 'GB' | 'SECONDS' | 'MINUTES' | 'HOURS';
}

export interface EagleFilterCondition {
  id: string;
  match: 'ALL' | 'ANY';
  result: 'MATCH' | 'NOT_MATCH';
  rules: EagleFilterRule[];
}

export interface EagleFilterQuery {
  version: typeof EAGLE_FILTER_QUERY_VERSION;
  conditions: EagleFilterCondition[];
}

export interface LegacyEagleFilterQuery {
  version: 1;
  filters: Record<string, unknown>;
}

export type StoredEagleFilterQuery = EagleFilterQuery | LegacyEagleFilterQuery;

export interface EagleFilterFieldDefinition {
  field: EagleFilterField;
  label: string;
  kind: 'TEXT' | 'SELECT' | 'TAGS' | 'NUMBER' | 'DATE' | 'COLOR';
  operators: readonly EagleFilterOperator[];
  defaultOperator: EagleFilterOperator;
  defaultValue?: EagleFilterValue;
  options?: readonly { value: string; label: string }[];
  units?: readonly { value: NonNullable<EagleFilterRule['unit']>; label: string }[];
}

const TEXT_OPERATORS = [
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'EQUALS',
  'NOT_EQUALS',
  'EMPTY',
  'NOT_EMPTY',
] as const;
const NUMBER_OPERATORS = ['GT', 'GTE', 'EQUALS', 'NOT_EQUALS', 'LT', 'LTE', 'BETWEEN'] as const;
const SET_OPERATORS = ['ANY_OF', 'ALL_OF', 'NONE_OF', 'EMPTY', 'NOT_EMPTY'] as const;
const DATE_OPERATORS = ['BEFORE', 'AFTER', 'BETWEEN', 'WITHIN_DAYS'] as const;

export const EAGLE_FILTER_FIELDS: readonly EagleFilterFieldDefinition[] = [
  {
    field: 'NAME',
    label: '名称',
    kind: 'TEXT',
    operators: TEXT_OPERATORS,
    defaultOperator: 'CONTAINS',
    defaultValue: '',
  },
  {
    field: 'FORMAT',
    label: '格式',
    kind: 'SELECT',
    operators: ['EQUALS', 'NOT_EQUALS'],
    defaultOperator: 'EQUALS',
    defaultValue: 'png',
    options: ['png', 'jpeg', 'webp', 'gif', 'svg', 'pdf', 'mp4', 'mov', 'mp3', 'wav'].map(
      (value) => ({ value, label: value.toUpperCase() }),
    ),
  },
  {
    field: 'MANUAL_TAGS',
    label: '标签',
    kind: 'TAGS',
    operators: SET_OPERATORS,
    defaultOperator: 'ALL_OF',
    defaultValue: [],
  },
  {
    field: 'AI_TAGS',
    label: 'AI 标签',
    kind: 'TAGS',
    operators: SET_OPERATORS,
    defaultOperator: 'ALL_OF',
    defaultValue: [],
  },
  {
    field: 'RATING',
    label: '评分',
    kind: 'SELECT',
    operators: ['EQUALS', 'NOT_EQUALS', 'GTE', 'LTE'],
    defaultOperator: 'EQUALS',
    defaultValue: '5',
    options: [
      { value: '0', label: '未评分' },
      ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} 星` })),
    ],
  },
  {
    field: 'WIDTH',
    label: '宽度',
    kind: 'NUMBER',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'GT',
    defaultValue: 1920,
  },
  {
    field: 'HEIGHT',
    label: '高度',
    kind: 'NUMBER',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'GT',
    defaultValue: 1080,
  },
  {
    field: 'FILE_SIZE',
    label: '大小',
    kind: 'NUMBER',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'GT',
    defaultValue: 1,
    units: [
      { value: 'KB', label: 'KB' },
      { value: 'MB', label: 'MB' },
      { value: 'GB', label: 'GB' },
    ],
  },
  {
    field: 'DURATION',
    label: '时长',
    kind: 'NUMBER',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'GT',
    defaultValue: 30,
    units: [
      { value: 'SECONDS', label: '秒' },
      { value: 'MINUTES', label: '分钟' },
      { value: 'HOURS', label: '小时' },
    ],
  },
  {
    field: 'SHAPE',
    label: '形状',
    kind: 'SELECT',
    operators: ['EQUALS', 'NOT_EQUALS'],
    defaultOperator: 'EQUALS',
    defaultValue: 'LANDSCAPE',
    options: [
      { value: 'LANDSCAPE', label: '横向' },
      { value: 'PORTRAIT', label: '纵向' },
      { value: 'SQUARE', label: '正方形' },
      { value: 'PANORAMA', label: '全景' },
    ],
  },
  {
    field: 'COLOR',
    label: '颜色',
    kind: 'COLOR',
    operators: ['SIMILAR'],
    defaultOperator: 'SIMILAR',
    defaultValue: '#2e86ab',
  },
  {
    field: 'DESCRIPTION',
    label: '注释',
    kind: 'TEXT',
    operators: TEXT_OPERATORS,
    defaultOperator: 'CONTAINS',
    defaultValue: '',
  },
  {
    field: 'SOURCE_URL',
    label: '链接',
    kind: 'TEXT',
    operators: TEXT_OPERATORS,
    defaultOperator: 'CONTAINS',
    defaultValue: '',
  },
  {
    field: 'ADDED_AT',
    label: '添加日期',
    kind: 'DATE',
    operators: DATE_OPERATORS,
    defaultOperator: 'AFTER',
    defaultValue: '',
  },
  {
    field: 'MODIFIED_AT',
    label: '修改日期',
    kind: 'DATE',
    operators: DATE_OPERATORS,
    defaultOperator: 'AFTER',
    defaultValue: '',
  },
] as const;

export const EAGLE_FILTER_OPERATOR_LABELS: Readonly<Record<EagleFilterOperator, string>> = {
  CONTAINS: '包含',
  NOT_CONTAINS: '不包含',
  STARTS_WITH: '开头是',
  ENDS_WITH: '结尾是',
  EQUALS: '等于',
  NOT_EQUALS: '不等于',
  EMPTY: '为空',
  NOT_EMPTY: '不为空',
  ANY_OF: '包含任一项',
  ALL_OF: '全部包含',
  NONE_OF: '均不包含',
  GT: '大于',
  GTE: '大于等于',
  LT: '小于',
  LTE: '小于等于',
  BETWEEN: '介于',
  BEFORE: '早于',
  AFTER: '晚于',
  WITHIN_DAYS: '最近天数',
  SIMILAR: '相似于',
};

const FIELD_DEFINITION_BY_NAME = new Map(EAGLE_FILTER_FIELDS.map((entry) => [entry.field, entry]));

export function getEagleFilterFieldDefinition(field: EagleFilterField) {
  return FIELD_DEFINITION_BY_NAME.get(field)!;
}

export function createEagleFilterRule(
  field: EagleFilterField = 'NAME',
  id = createFilterId('rule'),
): EagleFilterRule {
  const definition = getEagleFilterFieldDefinition(field);
  return {
    id,
    field,
    operator: definition.defaultOperator,
    value: cloneValue(definition.defaultValue),
    unit: definition.units?.[0]?.value,
  };
}

export function createEagleFilterCondition(id = createFilterId('condition')): EagleFilterCondition {
  return { id, match: 'ANY', result: 'MATCH', rules: [createEagleFilterRule()] };
}

export function createEmptyEagleFilterQuery(): EagleFilterQuery {
  return { version: EAGLE_FILTER_QUERY_VERSION, conditions: [createEagleFilterCondition()] };
}

export function toEagleFilterQuery(value: StoredEagleFilterQuery | undefined): EagleFilterQuery {
  if (value?.version === EAGLE_FILTER_QUERY_VERSION) return parseEagleFilterQuery(value);
  const filters = value?.version === 1 ? value.filters : {};
  const conditions: EagleFilterCondition[] = [];
  const addCondition = (rules: EagleFilterRule[], match: 'ALL' | 'ANY' = 'ALL') => {
    if (rules.length)
      conditions.push({
        id: createFilterId('condition'),
        match,
        result: 'MATCH',
        rules,
      });
  };
  const addRule = (
    field: EagleFilterField,
    operator: EagleFilterOperator,
    filterValue: EagleFilterValue | undefined,
  ) => {
    if (filterValue === undefined || (Array.isArray(filterValue) && filterValue.length === 0))
      return;
    addCondition([{ ...createEagleFilterRule(field), operator, value: filterValue }]);
  };
  if (typeof filters.search === 'string') addRule('NAME', 'CONTAINS', filters.search);
  if (Array.isArray(filters.formats)) {
    addCondition(
      filters.formats
        .filter((format): format is string => typeof format === 'string')
        .map((format) => ({ ...createEagleFilterRule('FORMAT'), value: format })),
      'ANY',
    );
  }
  const manualTagIds = stringArray(filters.manualTagIds);
  const aiTagIds = stringArray(filters.aiTagIds);
  if (manualTagIds.length || aiTagIds.length) {
    const operator: EagleFilterOperator = filters.tagMatch === 'ANY' ? 'ANY_OF' : 'ALL_OF';
    addCondition(
      [
        ...(manualTagIds.length
          ? [{ ...createEagleFilterRule('MANUAL_TAGS'), operator, value: manualTagIds }]
          : []),
        ...(aiTagIds.length
          ? [{ ...createEagleFilterRule('AI_TAGS'), operator, value: aiTagIds }]
          : []),
      ],
      filters.tagMatch === 'ANY' ? 'ANY' : 'ALL',
    );
  }
  if (typeof filters.rating === 'number') addRule('RATING', 'GTE', String(filters.rating));
  addLegacyNumberRange(conditions, 'WIDTH', filters.minWidth, filters.maxWidth);
  addLegacyNumberRange(conditions, 'HEIGHT', filters.minHeight, filters.maxHeight);
  addLegacyDateRange(conditions, 'ADDED_AT', filters.createdFrom, filters.createdTo);
  if (typeof filters.assetColor === 'string') addRule('COLOR', 'SIMILAR', filters.assetColor);
  return conditions.length
    ? { version: EAGLE_FILTER_QUERY_VERSION, conditions }
    : createEmptyEagleFilterQuery();
}

export function countActiveEagleFilterRules(query: EagleFilterQuery): number {
  return query.conditions.reduce(
    (count, condition) => count + condition.rules.filter(isActiveEagleFilterRule).length,
    0,
  );
}

export function isActiveEagleFilterRule(rule: EagleFilterRule): boolean {
  if (rule.operator === 'EMPTY' || rule.operator === 'NOT_EMPTY') return true;
  if (rule.field === 'COLOR')
    return typeof rule.value === 'string' && /^#[0-9a-f]{6}$/i.test(rule.value);
  if (Array.isArray(rule.value)) {
    const populated = rule.value.every(
      (value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''),
    );
    return (
      populated && (rule.operator === 'BETWEEN' ? rule.value.length === 2 : rule.value.length > 0)
    );
  }
  return rule.value !== undefined && rule.value !== null && String(rule.value).trim() !== '';
}

export function parseEagleFilterQuery(value: unknown): EagleFilterQuery {
  if (!isRecord(value) || value.version !== EAGLE_FILTER_QUERY_VERSION)
    throw new Error('筛选规则版本无效。');
  if (!Array.isArray(value.conditions) || value.conditions.length > EAGLE_FILTER_MAX_CONDITIONS)
    throw new Error('筛选条件组无效。');
  return {
    version: EAGLE_FILTER_QUERY_VERSION,
    conditions: value.conditions.map((condition, conditionIndex) =>
      parseCondition(condition, conditionIndex),
    ),
  };
}

function parseCondition(value: unknown, conditionIndex: number): EagleFilterCondition {
  if (!isRecord(value)) throw new Error(`第 ${conditionIndex + 1} 个条件组无效。`);
  if (value.match !== 'ALL' && value.match !== 'ANY') throw new Error('条件组匹配方式无效。');
  if (value.result !== 'MATCH' && value.result !== 'NOT_MATCH')
    throw new Error('条件组结果方式无效。');
  if (
    !Array.isArray(value.rules) ||
    value.rules.length === 0 ||
    value.rules.length > EAGLE_FILTER_MAX_RULES_PER_CONDITION
  )
    throw new Error('条件组内规则数量无效。');
  return {
    id: readId(value.id, `condition-${conditionIndex + 1}`),
    match: value.match,
    result: value.result,
    rules: value.rules.map((rule, ruleIndex) => parseRule(rule, conditionIndex, ruleIndex)),
  };
}

function parseRule(value: unknown, conditionIndex: number, ruleIndex: number): EagleFilterRule {
  if (!isRecord(value)) throw new Error('筛选规则无效。');
  const definition = EAGLE_FILTER_FIELDS.find((entry) => entry.field === value.field);
  if (!definition) throw new Error(`第 ${conditionIndex + 1} 组包含不支持的字段。`);
  if (!definition.operators.some((operator) => operator === value.operator))
    throw new Error(`字段“${definition.label}”的运算符无效。`);
  const rule: EagleFilterRule = {
    id: readId(value.id, `rule-${conditionIndex + 1}-${ruleIndex + 1}`),
    field: definition.field,
    operator: value.operator as EagleFilterOperator,
  };
  if (value.value !== undefined) rule.value = parseValue(value.value);
  if (value.unit !== undefined) {
    if (!definition.units?.some((unit) => unit.value === value.unit))
      throw new Error(`字段“${definition.label}”的单位无效。`);
    rule.unit = value.unit as NonNullable<EagleFilterRule['unit']>;
  }
  return rule;
}

function parseValue(value: unknown): EagleFilterValue {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
    return value;
  if (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((item) => typeof item === 'string')
  )
    return [...new Set(value)];
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  )
    return value as [number, number];
  throw new Error('筛选规则值无效。');
}

function readId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : fallback;
}

function cloneValue(value: EagleFilterValue | undefined): EagleFilterValue | undefined {
  return Array.isArray(value) ? ([...value] as EagleFilterValue) : value;
}

function createFilterId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function addLegacyNumberRange(
  conditions: EagleFilterCondition[],
  field: 'WIDTH' | 'HEIGHT',
  minimum: unknown,
  maximum: unknown,
) {
  if (typeof minimum === 'number' && typeof maximum === 'number') {
    conditions.push({
      id: createFilterId('condition'),
      match: 'ALL',
      result: 'MATCH',
      rules: [{ ...createEagleFilterRule(field), operator: 'BETWEEN', value: [minimum, maximum] }],
    });
  } else if (typeof minimum === 'number' || typeof maximum === 'number') {
    conditions.push({
      id: createFilterId('condition'),
      match: 'ALL',
      result: 'MATCH',
      rules: [
        {
          ...createEagleFilterRule(field),
          operator: typeof minimum === 'number' ? 'GTE' : 'LTE',
          value: (minimum ?? maximum) as number,
        },
      ],
    });
  }
}

function addLegacyDateRange(
  conditions: EagleFilterCondition[],
  field: 'ADDED_AT',
  from: unknown,
  to: unknown,
) {
  if (typeof from !== 'string' && typeof to !== 'string') return;
  conditions.push({
    id: createFilterId('condition'),
    match: 'ALL',
    result: 'MATCH',
    rules: [
      {
        ...createEagleFilterRule(field),
        operator:
          typeof from === 'string' && typeof to === 'string'
            ? 'BETWEEN'
            : typeof from === 'string'
              ? 'AFTER'
              : 'BEFORE',
        value: typeof from === 'string' && typeof to === 'string' ? [from, to] : String(from ?? to),
      },
    ],
  });
}
