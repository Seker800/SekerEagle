import { randomUUID } from 'node:crypto';

import {
  WORKSPACE_CHANGE_KINDS,
  type WorkspaceChangeKind,
  type WorkspaceChangeEvent,
} from '@sekereagle/library-core';
type Revisions = Partial<Record<WorkspaceChangeKind, string>>;
export type WorkspaceVisibility = boolean | Record<'MATERIAL' | 'PHOTO', boolean>;

/** Post-commit invalidation hints only. Reconnect changes the epoch instead of replaying facts. */
export class WorkspaceChangeState {
  private epoch = '';
  private ready = false;
  private readonly owners = new Map<string, { public: Revisions; all: Revisions }>();
  connected() {
    this.owners.clear();
    this.epoch = randomUUID();
    this.ready = true;
  }
  disconnected() {
    this.ready = false;
  }
  record(event: WorkspaceChangeEvent) {
    if (!this.ready) return;
    const key = JSON.stringify([event.ownerId, event.libraryMode]);
    let revisions = this.owners.get(key);
    if (!revisions) {
      revisions = { public: {}, all: {} };
      this.owners.set(key, revisions);
    }
    for (const kind of event.kinds) {
      revisions.all[kind] = String(BigInt(revisions.all[kind] ?? '0') + 1n);
      if (event.public) revisions.public[kind] = String(BigInt(revisions.public[kind] ?? '0') + 1n);
    }
  }
  snapshot(ownerId: string, includePrivate: WorkspaceVisibility) {
    if (!this.ready) throw new Error('WORKSPACE_CHANGE_LISTENER_UNAVAILABLE');
    const scope = (mode: 'MATERIAL' | 'PHOTO') => {
      const values = this.owners.get(JSON.stringify([ownerId, mode]));
      return Object.fromEntries(
        WORKSPACE_CHANGE_KINDS.map((kind) => [
          kind,
          values?.[
            (typeof includePrivate === 'boolean' ? includePrivate : includePrivate[mode])
              ? 'all'
              : 'public'
          ][kind] ?? '0',
        ]),
      ) as Record<WorkspaceChangeKind, string>;
    };
    return { epoch: this.epoch, scopes: { MATERIAL: scope('MATERIAL'), PHOTO: scope('PHOTO') } };
  }
}
