import { OPERATION_DB_BATCH_SIZE } from './eagle-operation-settings';

/** Prisma/PostgreSQL bind budget. Work targets are internal quanta, never selection limits. */
export const DATABASE_PARAMETER_LIMIT = 32767;
export interface DatabaseStatementBudget {
  readonly fixedParameters: number;
  readonly parametersPerRow: number;
  readonly targetRows: number;
}
const statement = (
  parametersPerRow: number,
  fixedParameters = 0,
  targetRows = OPERATION_DB_BATCH_SIZE,
): DatabaseStatementBudget => ({ parametersPerRow, fixedParameters, targetRows });
/**
 * Upper bounds include Prisma supplied defaults/timestamps. Arrays are one binding;
 * IN/OR lists expand. Prisma findMany also binds OFFSET even when it is zero.
 * Resolver budgets cover each statement separately, including
 * up to two live components and restore's (id, revision) pairs; they are not sums
 * of bindings across SQL round trips. Duplicate work targets retain the prior 500.
 */
export const DATABASE_STATEMENTS = {
  operationAssetLookup: statement(1, 8),
  operationTrashTargets: statement(4, 16),
  operationItems: statement(14),
  // unnest binds an entire ID array once, plus owner/mode/private visibility.
  operationMembership: statement(0, 4),
  duplicateIgnoreLookup: statement(4, 4, 500),
  duplicateOperationItems: statement(14, 0, 500),
  duplicateTrashTargets: statement(4, 16, 500),
  duplicateAssetLookup: statement(1, 8, 500),
  duplicateTagLookup: statement(1, 3, 500),
  duplicateTagInsert: statement(8, 0, 500),
  duplicateRestoreWhere: statement(2, 16, 500),
  duplicateRatingUpdate: statement(2, 2, 500),
  duplicateGroups: statement(9, 0, 500),
  duplicateVerificationLookup: statement(1, 7, 500),
  duplicateVerificationItems: statement(14, 0, 500),
  duplicateFingerprintPublish: statement(5, 6, 500),
  duplicateProofPublish: statement(4, 4, 500),
  transferTagLookup: statement(1, 3),
  transferTagGroupInsert: statement(10),
  transferTagInsert: statement(13),
  transferGroupMembershipInsert: statement(5),
  transferAssetTagInsert: statement(8),
  trashAssetMutation: statement(1, 8),
  trashRestoreJobs: statement(2, 16),
} as const satisfies Record<string, DatabaseStatementBudget>;

export function databaseBatchSize(budget: DatabaseStatementBudget): number {
  if (
    !Number.isSafeInteger(budget.fixedParameters) ||
    budget.fixedParameters < 0 ||
    !Number.isSafeInteger(budget.parametersPerRow) ||
    budget.parametersPerRow < 0 ||
    !Number.isSafeInteger(budget.targetRows) ||
    budget.targetRows < 1 ||
    budget.fixedParameters >= DATABASE_PARAMETER_LIMIT ||
    (budget.parametersPerRow === 0 && budget.fixedParameters === 0)
  )
    throw new Error('Invalid database statement budget');
  const capacity =
    budget.parametersPerRow === 0
      ? budget.targetRows
      : Math.floor((DATABASE_PARAMETER_LIMIT - budget.fixedParameters) / budget.parametersPerRow);
  if (capacity < 1) throw new Error('Invalid database statement budget: no row fits');
  return Math.min(budget.targetRows, capacity);
}
/** No truncation: offsets always refer to the complete original sequence. */
export function* databaseBatches<T>(
  rows: readonly T[],
  budget: DatabaseStatementBudget,
): Iterable<{ offset: number; rows: T[] }> {
  const size = databaseBatchSize(budget);
  for (let offset = 0; offset < rows.length; offset += size)
    yield { offset, rows: rows.slice(offset, offset + size) };
}
