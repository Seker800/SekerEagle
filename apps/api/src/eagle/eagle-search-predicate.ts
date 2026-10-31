import { Prisma } from '@prisma/client';

interface Relation {
  model: string;
  from: string;
  to: string;
  scoped: boolean;
}
interface Model {
  table: string;
  fields: ReadonlySet<string>;
  enums: Readonly<Record<string, string>>;
  relations: Readonly<Record<string, Relation>>;
}
const relation = (model: string, from = 'id', to = 'assetId', scoped = true): Relation => ({
  model,
  from,
  to,
  scoped,
});
const model = (
  table: string,
  fields: string,
  relations: Model['relations'] = {},
  enums: Model['enums'] = {},
): Model => ({
  table,
  fields: new Set(fields.split(' ')),
  relations,
  enums: { libraryMode: 'LibraryMode', ...enums },
});
// This adapter accepts only predicates produced by our shared filter engine. It is
// deliberately not a general Prisma query compiler, nor an interpreter for client SQL.
// New filter fields must pass the database parity contract before entering this surface.
const models: Readonly<Record<string, Model>> = {
  asset: model(
    'EagleAsset',
    'id ownerId libraryMode deletedAt purgeAfter isPrivate format rating width height byteSize durationMs aspectRatio libraryAddedAt chronologicalAt updatedAt normalizedDisplayName originalName mimeType mediaRevision',
    {
      annotation: relation('annotation'),
      photoMetadata: relation('metadata'),
      photoLocation: relation('location'),
      photoFaces: relation('face'),
      manualTagLinks: relation('manualLink'),
      aiTagLinks: relation('aiLink'),
      colorAnalyses: relation('analysis'),
      embeddings: relation('embedding'),
      owner: relation('owner', 'ownerId', 'id', false),
    },
  ),
  annotation: model('EagleAssetAnnotation', 'ownerId libraryMode assetId description sourceUrl'),
  metadata: model(
    'EaglePhotoMetadata',
    'ownerId libraryMode assetId cameraModel lensModel capturedAt latitude longitude',
  ),
  location: model('EaglePhotoLocation', 'ownerId libraryMode assetId name'),
  face: model('EaglePhotoFace', 'ownerId libraryMode assetId personId isCurrent'),
  manualLink: model('EagleAssetManualTag', 'ownerId libraryMode assetId tagId', {
    tag: relation('tag', 'tagId', 'id'),
  }),
  tag: model('EagleManualTag', 'id ownerId libraryMode normalizedName'),
  aiLink: model(
    'EagleAssetAiTag',
    'ownerId libraryMode assetId aiTagId status',
    {},
    { status: 'EagleAiTagStatus' },
  ),
  analysis: model(
    'EagleAssetColorAnalysis',
    'id ownerId libraryMode assetId isCurrent processorVersion status',
    { swatches: relation('swatch', 'id', 'analysisId') },
    { status: 'EagleColorAnalysisStatus' },
  ),
  swatch: model('EagleAssetColorSwatch', 'ownerId libraryMode analysisId weight labL labA labB'),
  embedding: model(
    'EagleAssetEmbedding',
    'id ownerId libraryMode assetId assetRevision spaceId status isCurrent',
    { smartFolderMatches: relation('match', 'id', 'embeddingId') },
    { status: 'EagleEmbeddingStatus' },
  ),
  match: model('EagleSmartFolderSemanticMatch', 'ownerId libraryMode embeddingId snapshotId', {
    snapshot: relation('snapshot', 'snapshotId', 'id'),
  }),
  snapshot: model('EagleSmartFolderSemanticSnapshot', 'id ownerId libraryMode folderId isActive'),
  owner: model('User', 'id', { eagleSmartFolders: relation('folder', 'id', 'ownerId', false) }),
  folder: model('EagleSmartFolder', 'id ownerId libraryMode', {
    semanticSnapshots: relation('snapshot', 'id', 'folderId'),
  }),
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date)
    throw new Error('Unsupported search predicate shape');
  return value as Record<string, unknown>;
}
function combine(parts: Prisma.Sql[], operator: 'AND' | 'OR') {
  return parts.length
    ? Prisma.sql`(${Prisma.join(parts, ` ${operator} `)})`
    : Prisma.raw(operator === 'AND' ? 'TRUE' : 'FALSE');
}
function parameter(value: unknown, enumType?: string): Prisma.Sql {
  if (!(value instanceof Date) && !['string', 'number', 'bigint', 'boolean'].includes(typeof value))
    throw new Error('Unsupported search scalar value');
  return enumType ? Prisma.sql`${value}::${Prisma.raw(`"${enumType}"`)}` : Prisma.sql`${value}`;
}
function scalar(
  column: Prisma.Sql,
  value: unknown,
  enumType?: string,
  inheritedInsensitive = false,
): Prisma.Sql {
  if (value === null) return Prisma.sql`${column} IS NULL`;
  if (value instanceof Date || typeof value !== 'object')
    return Prisma.sql`${column}=${parameter(value, enumType)}`;
  const input = object(value);
  if (input.mode !== undefined && input.mode !== 'default' && input.mode !== 'insensitive')
    throw new Error('Unsupported search text mode');
  const insensitive = input.mode === 'insensitive' || inheritedInsensitive;
  const parts: Prisma.Sql[] = [];
  for (const [operator, operand] of Object.entries(input)) {
    if (operand === undefined || operator === 'mode') continue;
    switch (operator) {
      case 'equals':
        parts.push(
          operand === null
            ? Prisma.sql`${column} IS NULL`
            : insensitive
              ? Prisma.sql`${column} ILIKE ${parameter(operand)}`
              : Prisma.sql`${column}=${parameter(operand, enumType)}`,
        );
        break;
      case 'not':
        parts.push(
          operand === null
            ? Prisma.sql`${column} IS NOT NULL`
            : Prisma.sql`NOT (${scalar(column, operand, enumType, insensitive)})`,
        );
        break;
      case 'in':
      case 'notIn': {
        if (!Array.isArray(operand)) throw new Error('Unsupported search set value');
        const values = operand.map((value) => parameter(value, enumType));
        parts.push(
          values.length
            ? Prisma.sql`${column} ${Prisma.raw(operator === 'in' ? 'IN' : 'NOT IN')} (${Prisma.join(values)})`
            : Prisma.raw(operator === 'in' ? 'FALSE' : 'TRUE'),
        );
        break;
      }
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        parts.push(
          Prisma.sql`${column} ${Prisma.raw({ lt: '<', lte: '<=', gt: '>', gte: '>=' }[operator])} ${parameter(operand, enumType)}`,
        );
        break;
      case 'contains':
      case 'startsWith':
      case 'endsWith':
        if (typeof operand !== 'string') throw new Error('Unsupported search text value');
        // Preserve the canonical Prisma filter's LIKE semantics; direct free-text
        // search separately escapes user literals before constructing its pattern.
        parts.push(
          Prisma.sql`${column} ${Prisma.raw(insensitive ? 'ILIKE' : 'LIKE')} ${`${operator !== 'startsWith' ? '%' : ''}${operand}${operator !== 'endsWith' ? '%' : ''}`}`,
        );
        break;
      default:
        throw new Error('Unsupported search scalar operator');
    }
  }
  return combine(parts, 'AND');
}

/** Keep eligibility inside PostgreSQL instead of materializing an entire library's IDs in Node. */
export function compileSearchPredicate(where: Prisma.EagleAssetWhereInput): Prisma.Sql {
  let sequence = 0;
  const visit = (name: string, alias: string, input: unknown): Prisma.Sql => {
    const definition = models[name]!;
    const column = (key: string) => Prisma.raw(`${alias}."${key}"`);
    const parts: Prisma.Sql[] = [];
    for (const [key, value] of Object.entries(object(input))) {
      if (value === undefined) continue;
      if (key === 'AND' || key === 'OR' || key === 'NOT') {
        const entries = (Array.isArray(value) ? value : [value]).map((value) =>
          visit(name, alias, value),
        );
        parts.push(
          key === 'NOT'
            ? combine(
                entries.map((entry) => Prisma.sql`NOT (${entry})`),
                'AND',
              )
            : combine(entries, key),
        );
      } else if (definition.fields.has(key)) {
        parts.push(scalar(column(key), value, definition.enums[key]));
      } else {
        const link = definition.relations[key];
        if (!link) throw new Error('Unsupported search predicate field');
        const target = models[link.model]!;
        const next = `search_scope_${++sequence}`;
        const exists = (
          condition: unknown,
        ) => Prisma.sql`EXISTS (SELECT 1 FROM ${Prisma.raw(`"${target.table}"`)} ${Prisma.raw(next)}
          WHERE ${Prisma.raw(`${next}."${link.to}"`)}=${column(link.from)}
          ${link.scoped ? Prisma.sql`AND ${Prisma.raw(`${next}."ownerId"`)}=${column('ownerId')} AND ${Prisma.raw(`${next}."libraryMode"`)}=${column('libraryMode')}` : Prisma.empty}
          AND ${visit(link.model, next, condition)})`;
        if (value === null) {
          parts.push(Prisma.sql`NOT (${exists({})})`);
          continue;
        }
        const filter = object(value);
        const operators = Object.keys(filter).filter((key) =>
          ['some', 'none', 'every', 'is', 'isNot'].includes(key),
        );
        if (operators.length && operators.length !== Object.keys(filter).length)
          throw new Error('Unsupported search relation operator');
        if (!operators.length) parts.push(exists(filter));
        else
          for (const operator of operators) {
            const operand = filter[operator];
            if (operand === undefined) continue;
            if (operator === 'some' || operator === 'is')
              parts.push(operand === null ? Prisma.sql`NOT (${exists({})})` : exists(operand));
            else if (operator === 'every')
              parts.push(Prisma.sql`NOT (${exists({ NOT: operand })})`);
            else parts.push(operand === null ? exists({}) : Prisma.sql`NOT (${exists(operand)})`);
          }
      }
    }
    return combine(parts, 'AND');
  };
  return visit('asset', 'asset', where);
}

export const literalSearchPattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;
