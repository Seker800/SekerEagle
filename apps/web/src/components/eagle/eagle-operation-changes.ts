import type { DuplicateCleanupInput } from '../../lib/eagle-duplicates-api';
import type {
  AssetOperationKind,
  AssetOperationReceipt,
  AssetOperationSummary,
  AssetMembershipFact,
} from '@sekereagle/library-core';

export interface EagleOperationChange {
  id: string;
  kind: AssetOperationKind;
  assetIds: string[];
  requestAssetIds: string[];
  expectedTotal: number;
  failedIds: string[];
  pending: boolean;
  intentVersion: number;
  uncertain: boolean;
  message: string | null;
  summary?: AssetOperationSummary;
  dismissed?: boolean;
  undoId?: string;
  groupSignatures?: string[];
  duplicateInput?: DuplicateCleanupInput;
  finishedGroups?: string[];
  completedAt?: number;
}
/** Membership facts share the existing owner/mode workspace lifetime, never a second entity cache. */
export class EagleOperationChanges {
  private readonly operations = new Map<string, EagleOperationChange>();
  private readonly facts = new Map<
    string,
    { state: 'ACTIVE' | 'TRASH' | 'REMOVED'; version: number | null; observedRevision: number }
  >();
  private readonly listeners = new Set<() => void>();
  private readonly beforeListeners = new Set<() => void>();
  subscribeBeforeChange = (listener: () => void) => {
    this.beforeListeners.add(listener);
    return () => {
      this.beforeListeners.delete(listener);
    };
  };
  private beforeChange() {
    for (const listener of this.beforeListeners) listener();
  }
  private revision = 0;
  epoch = 0;
  private readonly hiddenActive = new Map<string, number>();
  private readonly hiddenTrash = new Map<string, number>();
  countOverride: number | null = null;
  adjustCount(base: number | undefined, delta: number) {
    if (this.countOverride === null && base === undefined) return;
    this.countOverride = Math.max(0, (this.countOverride ?? base ?? 0) + delta);
  }
  confirmCounts() {
    if (!this.hasPending() && this.countOverride !== null) {
      this.countOverride = null;
      this.emit();
    }
  }
  private index(entry: EagleOperationChange, delta: number) {
    const index =
      entry.kind === 'RESTORE'
        ? this.hiddenTrash
        : entry.kind === 'TRASH' || entry.kind === 'DUPLICATE_CLEANUP'
          ? this.hiddenActive
          : null;
    if (!index) return;
    for (const id of entry.assetIds) {
      const count = (index.get(id) ?? 0) + delta;
      if (count > 0) index.set(id, count);
      else index.delete(id);
    }
  }
  getSnapshot = () => this.revision;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get entries() {
    return [...this.operations.values()];
  }
  hasPending = () => this.entries.some((entry) => entry.pending);
  begin(id: string, kind: AssetOperationKind, assetIds: string[], expectedTotal = assetIds.length) {
    if (this.operations.has(id)) return;
    this.beforeChange();
    this.operations.set(id, {
      id,
      kind,
      assetIds: [...new Set(assetIds)],
      requestAssetIds: [...new Set(assetIds)],
      expectedTotal,
      failedIds: [],
      pending: true,
      intentVersion: 0,
      uncertain: false,
      message: null,
    });
    this.index(this.operations.get(id)!, 1);
    this.emit();
  }
  expand(id: string, assetIds: string[]) {
    const entry = this.operations.get(id);
    if (!entry) return;
    this.beforeChange();
    if (entry.pending) this.index(entry, -1);
    entry.assetIds = [...new Set([...entry.assetIds, ...assetIds])];
    if (entry.pending) this.index(entry, 1);
    this.emit();
  }
  observe(summary: AssetOperationSummary) {
    const current = this.operations.get(summary.id);
    if (current) {
      if (!current.pending && (summary.running || summary.queued)) return;
      current.summary = summary;
      current.uncertain = false;
      current.message = null;
      this.emit();
    }
  }
  uncertain(id: string, message: string) {
    const current = this.operations.get(id);
    if (current?.pending) {
      current.uncertain = true;
      current.message = message;
      this.emit();
    }
  }
  reject(id: string, message: string) {
    this.beforeChange();
    const current = this.operations.get(id);
    if (current) {
      if (current.pending) this.index(current, -1);
      current.pending = false;
      current.failedIds = current.assetIds;
      current.message = message;
      this.emit();
    }
  }
  finish(
    id: string,
    kind: AssetOperationKind,
    receipts: AssetOperationReceipt[],
    summary?: AssetOperationSummary,
    membership: readonly AssetMembershipFact[] = [],
    readRevision = this.revision,
  ) {
    this.beforeChange();
    const current = this.operations.get(id);
    for (const fact of membership) this.applyFact(fact, readRevision);
    if (current) {
      if (current.pending) this.index(current, -1);
      current.kind = kind;
      current.pending = false;
      current.completedAt = Date.now();
      current.finishedGroups = receipts
        .filter((row) => row.status === 'COMPLETED' && row.groupSignature)
        .map((row) => row.groupSignature!);
      current.uncertain = false;
      current.summary = summary;
      current.failedIds = [
        ...new Set(
          receipts.filter((row) => row.status === 'FAILED').flatMap((row) => row.assetIds),
        ),
      ];
      current.message = null;
    }
    this.emit();
  }
  private applyFact(fact: AssetMembershipFact, readRevision: number) {
    const previous = this.facts.get(fact.id);
    if (previous) {
      if (previous.version === null || fact.rowVersion === null) {
        if (previous.observedRevision > readRevision) return false;
      } else if (fact.rowVersion < previous.version) return false;
    }
    this.facts.set(fact.id, {
      state: fact.state === 'UNAVAILABLE' ? 'REMOVED' : fact.state,
      version: fact.rowVersion,
      observedRevision: this.revision + 1,
    });
    return true;
  }
  observePage(
    assets: readonly { id: string; rowVersion: number }[],
    trash: boolean,
    readRevision = this.revision,
  ) {
    let changed = false;
    for (const asset of assets) {
      if (this.facts.has(asset.id))
        changed =
          this.applyFact(
            { id: asset.id, rowVersion: asset.rowVersion, state: trash ? 'TRASH' : 'ACTIVE' },
            readRevision,
          ) || changed;
    }
    if (changed) this.emit();
  }
  setDuplicateInput(id: string, input: DuplicateCleanupInput) {
    const entry = this.operations.get(id);
    if (entry) entry.duplicateInput = input;
  }
  visible(id: string, trash: boolean) {
    const fact = this.facts.get(id)?.state;
    if (fact === 'REMOVED' || (fact === 'TRASH' && !trash) || (fact === 'ACTIVE' && trash))
      return false;
    return !(trash ? this.hiddenTrash : this.hiddenActive).has(id);
  }
  setGroups(id: string, groupSignatures: string[]) {
    const entry = this.operations.get(id);
    if (entry) {
      entry.groupSignatures = groupSignatures;
      this.emit();
    }
  }
  resume(id: string) {
    const entry = this.operations.get(id);
    if (entry && !entry.pending) {
      this.beforeChange();
      entry.assetIds = entry.failedIds;
      entry.failedIds = [];
      entry.pending = true;
      entry.intentVersion++;
      entry.dismissed = false;
      this.index(entry, 1);
      this.emit();
    }
  }
  setUndo(id: string, undoId: string) {
    const entry = this.operations.get(id);
    if (entry && entry.undoId !== undoId) {
      entry.undoId = undoId;
      this.emit();
    }
  }
  dismiss(id: string) {
    const entry = this.operations.get(id);
    if (entry) {
      entry.dismissed = true;
      this.emit();
    }
  }
  clear() {
    this.epoch++;
    this.operations.clear();
    this.facts.clear();
    this.hiddenActive.clear();
    this.hiddenTrash.clear();
    this.countOverride = null;
    this.emit();
  }
  private emit() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}
