import { isActiveEagleFilterRule, parseEagleFilterQuery } from '@sekereagle/eagle-filter-core';

/** Conservative proof only: retain the original branch unless positive rules exclude it. */
export function canMatchWithoutSemantic(stored: unknown): boolean {
  if (!stored || typeof stored !== 'object' || !('version' in stored) || stored.version !== 2)
    return true;
  const query = parseEagleFilterQuery(stored);
  if (query.semantic) return false;
  return !query.conditions.some((condition) => {
    if (condition.result !== 'MATCH') return false;
    const rules = condition.rules.filter(isActiveEagleFilterRule);
    return (
      rules.length > 0 &&
      (condition.match === 'ALL'
        ? rules.some((rule) => rule.field === 'SEMANTIC')
        : rules.every((rule) => rule.field === 'SEMANTIC'))
    );
  });
}
