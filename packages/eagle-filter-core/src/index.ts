export const EAGLE_FILTER_QUERY_VERSION = 2 as const;
// The previous format allowed thirty ordinary groups plus one top-level scene.
export const EAGLE_FILTER_MAX_CONDITIONS = 31;
export const EAGLE_FILTER_MAX_RULES_PER_CONDITION = 30;

export type EagleFilterField =
  | 'SEMANTIC'
  | 'CITY'
  | 'CAMERA_MODEL'
  | 'LENS_MODEL'
  | 'GPS'
  | 'PERSON'
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
  breadth?: EagleSemanticIntent['breadth'];
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
  /** Persistent smart-folder intent; ordinary filters remain live. */
  semantic?: EagleSemanticIntent;
}

export interface EagleSemanticIntent {
  text: string;
  breadth: 'STRICT' | 'BALANCED' | 'BROAD';
}

// Similarity thresholds are retrieval policy, not probabilities of correctness.
export const EAGLE_SEMANTIC_THRESHOLDS = { STRICT: 0.35, BALANCED: 0.3, BROAD: 0.25 } as const;

export function parseEagleSemanticIntent(value: unknown, allowEmpty = false): EagleSemanticIntent {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['text', 'breadth'].includes(key)) ||
    typeof value.text !== 'string' ||
    typeof value.breadth !== 'string' ||
    !['STRICT', 'BALANCED', 'BROAD'].includes(String(value.breadth))
  )
    throw new Error('画面内容条件无效。');
  const text = value.text.normalize('NFKC').trim();
  if ((!text && !allowEmpty) || text.length > 500)
    throw new Error('画面描述需要 1 至 500 个字符。');
  return { text, breadth: value.breadth as EagleSemanticIntent['breadth'] };
}

export interface LegacyEagleFilterQuery {
  version: 1;
  filters: Record<string, unknown>;
}

export type StoredEagleFilterQuery = EagleFilterQuery | LegacyEagleFilterQuery;

export interface EagleFilterFieldDefinition {
  field: EagleFilterField;
  smartFolderOnly?: boolean;
  libraryModes?: readonly ('MATERIAL' | 'PHOTO')[];
  kind: 'TEXT' | 'SELECT' | 'TAGS' | 'NUMBER' | 'DATE' | 'COLOR';
  operators: readonly EagleFilterOperator[];
  defaultOperator: EagleFilterOperator;
  defaultValue?: EagleFilterValue;
  options?: readonly { value: string }[];
  units?: readonly { value: NonNullable<EagleFilterRule['unit']> }[];
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
    field: 'SEMANTIC',
    smartFolderOnly: true,
    kind: 'TEXT',
    operators: ['SIMILAR'],
    defaultOperator: 'SIMILAR',
    defaultValue: '',
  },
  ...(['CITY', 'CAMERA_MODEL', 'LENS_MODEL'] as const).map((field) => ({
    field,
    libraryModes: ['PHOTO'] as const,
    kind: 'TEXT' as const,
    operators: TEXT_OPERATORS,
    defaultOperator: 'CONTAINS' as const,
    defaultValue: '',
  })),
  {
    field: 'GPS',
    libraryModes: ['PHOTO'],
    kind: 'SELECT',
    operators: ['EQUALS'],
    defaultOperator: 'EQUALS',
    defaultValue: 'WITH',
    options: [{ value: 'WITH' }, { value: 'WITHOUT' }],
  },
  {
    field: 'PERSON',
    libraryModes: ['PHOTO'],
    kind: 'TEXT',
    operators: ['EQUALS'],
    defaultOperator: 'EQUALS',
    defaultValue: '',
  },
  {
    field: 'NAME',
    kind: 'TEXT',
    operators: TEXT_OPERATORS,
    defaultOperator: 'CONTAINS',
    defaultValue: '',
  },
  {
    field: 'FORMAT',
    kind: 'SELECT',
    operators: ['EQUALS', 'NOT_EQUALS'],
    defaultOperator: 'EQUALS',
    defaultValue: 'png',
    options: ['png', 'jpeg', 'webp', 'gif', 'svg', 'pdf', 'mp4', 'mov', 'mp3', 'wav'].map(
      (value) => ({ value }),
    ),
  },
  {
    field: 'MANUAL_TAGS',
    kind: 'TAGS',
    operators: SET_OPERATORS,
    defaultOperator: 'ALL_OF',
    defaultValue: [],
  },
  {
    field: 'AI_TAGS',
    kind: 'TAGS',
    operators: SET_OPERATORS,
    defaultOperator: 'ALL_OF',
    defaultValue: [],
  },
  {
    field: 'RATING',
    kind: 'SELECT',
    operators: ['EQUALS', 'NOT_EQUALS', 'GTE', 'LTE'],
    defaultOperator: 'EQUALS',
    defaultValue: '5',
    options: [{ value: '0' }, ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value) }))],
  },
  {
    field: 'WIDTH',
    kind: 'NUMBER',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'GT',
    defaultValue: 1920,
  },
  {
    field: 'HEIGHT',
    kind: 'NUMBER',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'GT',
    defaultValue: 1080,
  },
  {
    field: 'FILE_SIZE',
    kind: 'NUMBER',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'GT',
    defaultValue: 1,
    units: [{ value: 'KB' }, { value: 'MB' }, { value: 'GB' }],
  },
  {
    field: 'DURATION',
    kind: 'NUMBER',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'GT',
    defaultValue: 30,
    units: [{ value: 'SECONDS' }, { value: 'MINUTES' }, { value: 'HOURS' }],
  },
  {
    field: 'SHAPE',
    kind: 'SELECT',
    operators: ['EQUALS', 'NOT_EQUALS'],
    defaultOperator: 'EQUALS',
    defaultValue: 'LANDSCAPE',
    options: [
      { value: 'LANDSCAPE' },
      { value: 'PORTRAIT' },
      { value: 'SQUARE' },
      { value: 'PANORAMA' },
    ],
  },
  {
    field: 'COLOR',
    kind: 'COLOR',
    operators: ['SIMILAR'],
    defaultOperator: 'SIMILAR',
    defaultValue: '#2e86ab',
  },
  {
    field: 'DESCRIPTION',
    kind: 'TEXT',
    operators: TEXT_OPERATORS,
    defaultOperator: 'CONTAINS',
    defaultValue: '',
  },
  {
    field: 'SOURCE_URL',
    kind: 'TEXT',
    operators: TEXT_OPERATORS,
    defaultOperator: 'CONTAINS',
    defaultValue: '',
  },
  {
    field: 'ADDED_AT',
    kind: 'DATE',
    operators: DATE_OPERATORS,
    defaultOperator: 'AFTER',
    defaultValue: '',
  },
  {
    field: 'MODIFIED_AT',
    kind: 'DATE',
    operators: DATE_OPERATORS,
    defaultOperator: 'AFTER',
    defaultValue: '',
  },
] as const;

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
  if (!Array.isArray(value.conditions)) throw new Error('筛选条件组无效。');
  // A legacy top-level scene consumes the same one-group budget as its editable form.
  if (
    value.conditions.length + (value.semantic === undefined ? 0 : 1) >
    EAGLE_FILTER_MAX_CONDITIONS
  )
    throw new Error('筛选条件组无效。');
  const query: EagleFilterQuery = {
    version: EAGLE_FILTER_QUERY_VERSION,
    ...(value.semantic === undefined ? {} : { semantic: parseEagleSemanticIntent(value.semantic) }),
    conditions: value.conditions.map((condition, conditionIndex) =>
      parseCondition(condition, conditionIndex),
    ),
  };
  const sceneRules = query.conditions
    .flatMap((condition) => condition.rules)
    .filter((rule) => rule.field === 'SEMANTIC');
  if (sceneRules.length + (query.semantic ? 1 : 0) > 1)
    throw new Error('每个智能文件夹支持一条画面内容条件。');
  return query;
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
    throw new Error(`字段“${definition.field}”的运算符无效。`);
  const rule: EagleFilterRule = {
    id: readId(value.id, `rule-${conditionIndex + 1}-${ruleIndex + 1}`),
    field: definition.field,
    operator: value.operator as EagleFilterOperator,
  };
  if (value.value !== undefined) rule.value = parseValue(value.value);
  if (definition.field === 'SEMANTIC') {
    const intent = parseEagleSemanticIntent(
      {
        text: value.value,
        breadth: value.breadth ?? 'BALANCED',
      },
      true,
    );
    rule.value = intent.text;
    rule.breadth = intent.breadth;
  }
  if (value.unit !== undefined) {
    if (!definition.units?.some((unit) => unit.value === value.unit))
      throw new Error(`字段“${definition.field}”的单位无效。`);
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

export function getEagleFilterFields(libraryMode: 'MATERIAL' | 'PHOTO') {
  return EAGLE_FILTER_FIELDS.filter(
    (definition) => !definition.libraryModes || definition.libraryModes.includes(libraryMode),
  );
}
export function assertEagleFilterQueryMode(
  query: EagleFilterQuery,
  libraryMode: 'MATERIAL' | 'PHOTO',
) {
  const allowed = new Set(getEagleFilterFields(libraryMode).map(({ field }) => field));
  if (query.conditions.some(({ rules }) => rules.some(({ field }) => !allowed.has(field))))
    throw new Error('摄影筛选只适用于照片图库。');
}

/** One bounded vector intent per folder; its placement obeys the ordinary Boolean groups. */
export function readEagleSemanticIntent(query: EagleFilterQuery): EagleSemanticIntent | undefined {
  if (query.semantic) return query.semantic;
  const rule = query.conditions
    .flatMap((condition) => condition.rules)
    .find((rule) => rule.field === 'SEMANTIC' && isActiveEagleFilterRule(rule));
  return rule
    ? parseEagleSemanticIntent({ text: rule.value, breadth: rule.breadth ?? 'BALANCED' })
    : undefined;
}

/** Compatibility adapter: old top-level intent was always an extra AND condition. */
export function editableEagleFilterQuery(query: EagleFilterQuery): EagleFilterQuery {
  if (!query.semantic) return query;
  const { semantic, ...ordinary } = query;
  return {
    ...ordinary,
    conditions: [
      ...query.conditions,
      {
        id: createFilterId('condition'),
        match: 'ALL',
        result: 'MATCH',
        rules: [
          {
            id: createFilterId('rule'),
            field: 'SEMANTIC',
            operator: 'SIMILAR',
            value: semantic.text,
            breadth: semantic.breadth,
          },
        ],
      },
    ],
  };
}
