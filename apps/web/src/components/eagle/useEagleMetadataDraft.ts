import { useCallback, useState } from 'react';
import type { EagleAsset, EagleAssetChanges } from '../../lib/eagle-api';

type Field = 'displayName' | 'description' | 'sourceUrl';
type Values = Record<Field, string>;
interface Draft {
  scope: string;
  assetId: string;
  values: Values;
  dirtyFields: Set<Field>;
  revision: number;
}
const emptyValues: Values = { displayName: '', description: '', sourceUrl: '' };

/** Draft revisions protect edits from processing refreshes and late mutation acknowledgements. */
export function useEagleMetadataDraft(scopeKey: string) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = draft?.scope === scopeKey ? draft : null;
  const load = useCallback(
    (asset: Pick<EagleAsset, 'id' | 'displayName' | 'annotation'>) => {
      setDraft((previous) => {
        const same = previous?.scope === scopeKey && previous.assetId === asset.id;
        if (same && previous.dirtyFields.size) return previous;
        return {
          scope: scopeKey,
          assetId: asset.id,
          values: {
            displayName: asset.displayName,
            description: asset.annotation?.description ?? '',
            sourceUrl: asset.annotation?.sourceUrl ?? '',
          },
          dirtyFields: new Set(),
          revision: previous?.revision ?? 0,
        };
      });
    },
    [scopeKey],
  );
  const change = useCallback(
    (field: Field, value: string) => {
      setDraft((previous) =>
        previous?.scope === scopeKey
          ? {
              ...previous,
              values: { ...previous.values, [field]: value },
              dirtyFields: new Set([...previous.dirtyFields, field]),
              revision: previous.revision + 1,
            }
          : previous,
      );
    },
    [scopeKey],
  );
  const saved = useCallback(
    (assetId: string, revision: number) => {
      setDraft((previous) =>
        previous?.scope === scopeKey &&
        previous.assetId === assetId &&
        previous.revision === revision
          ? { ...previous, dirtyFields: new Set() }
          : previous,
      );
    },
    [scopeKey],
  );
  const submission = () => {
    if (!current?.dirtyFields.size || !current.values.displayName.trim()) return null;
    const input: Pick<EagleAssetChanges, Field> = {};
    if (current.dirtyFields.has('displayName')) input.displayName = current.values.displayName;
    if (current.dirtyFields.has('description'))
      input.description = current.values.description.trim() || null;
    if (current.dirtyFields.has('sourceUrl'))
      input.sourceUrl = current.values.sourceUrl.trim() || null;
    return { assetId: current.assetId, revision: current.revision, input };
  };
  return {
    assetId: current?.assetId ?? null,
    values: current?.values ?? emptyValues,
    dirty: Boolean(current?.dirtyFields.size),
    load,
    change,
    saved,
    submission,
  };
}
