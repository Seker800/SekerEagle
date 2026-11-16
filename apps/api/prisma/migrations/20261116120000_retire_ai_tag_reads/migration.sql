-- Retire AI tag read paths (2026-11-16).
--
-- Generation was retired on 2026-10-24 and every read surface is gone with this change:
-- asset responses, filters, smart-folder dependencies and search suggestions. The tag rows
-- themselves are historical user data and are intentionally kept until a separate, explicit
-- drop decision. Only the derived dependency rows and stored rule fragments are removed.

-- v1 stored filters: { version: 1, filters: { ..., aiTagIds: [...] } }
UPDATE "EagleSmartFolder"
SET "queryJson" = jsonb_set("queryJson", '{filters}', ("queryJson" -> 'filters') - 'aiTagIds')
WHERE jsonb_typeof("queryJson" -> 'filters') = 'object'
  AND ("queryJson" -> 'filters') ? 'aiTagIds';

-- v2 stored filters: { version: 2, conditions: [ { rules: [ { field: 'AI_TAGS', ... } ] } ] }
-- Drops the rule and any condition left with no rules. A folder whose every condition was an
-- AI tag filter becomes an unfiltered folder, which is the only meaningful result once the
-- field no longer exists.
UPDATE "EagleSmartFolder" f
SET "queryJson" = jsonb_set(
  f."queryJson",
  '{conditions}',
  COALESCE(
    (
      SELECT jsonb_agg(jsonb_set(c.value, '{rules}', filtered.rules) ORDER BY c.ord)
      FROM jsonb_array_elements(f."queryJson" -> 'conditions')
        WITH ORDINALITY AS c(value, ord)
      CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(r.value ORDER BY r.ord), '[]'::jsonb) AS rules
        FROM jsonb_array_elements(c.value -> 'rules') WITH ORDINALITY AS r(value, ord)
        WHERE r.value ->> 'field' <> 'AI_TAGS'
      ) AS filtered
      WHERE jsonb_array_length(filtered.rules) > 0
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof(f."queryJson" -> 'conditions') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(f."queryJson" -> 'conditions') AS c2(value),
         jsonb_array_elements(c2.value -> 'rules') AS r2(value)
    WHERE r2.value ->> 'field' = 'AI_TAGS'
  );

-- Dependency rows are derived from the stored rules above and are no longer read or written.
DELETE FROM "EagleSmartFolderAiTagDependency";
