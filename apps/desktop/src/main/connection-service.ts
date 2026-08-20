import {
  normalizeConnectionSettings,
  type DesktopConnectionSettings,
} from './connection-config';
import type {
  ActiveDesktopConnection,
  ConnectionResolution,
  DesktopConnectionResolver,
} from './connection-resolver';

interface ConnectionSettingsStore {
  load(): Promise<DesktopConnectionSettings>;
  save(settings: unknown): Promise<DesktopConnectionSettings>;
}

interface ConnectionResolver {
  resolve(settings: DesktopConnectionSettings): Promise<ConnectionResolution>;
}

export interface DesktopConnectionSnapshot {
  settings: DesktopConnectionSettings;
  active: ActiveDesktopConnection | null;
  probes: ConnectionResolution['probes'];
}

export class DesktopConnectionService {
  private snapshot: DesktopConnectionSnapshot | null = null;

  constructor(
    private readonly store: ConnectionSettingsStore,
    private readonly resolver: ConnectionResolver | DesktopConnectionResolver,
  ) {}

  async initialize(): Promise<DesktopConnectionSnapshot> {
    if (this.snapshot) return this.snapshot;
    return this.resolveAndPersist(await this.store.load());
  }

  current(): DesktopConnectionSnapshot | null {
    return this.snapshot;
  }

  async test(input: unknown): Promise<DesktopConnectionSnapshot> {
    const current = await this.ensureInitialized();
    const settings = {
      ...rendererSettings(input, current.settings),
      activeSlot: null,
    };
    const resolution = await this.resolver.resolve(settings);
    return { settings, ...resolution };
  }

  async save(input: unknown): Promise<DesktopConnectionSnapshot> {
    const current = await this.ensureInitialized();
    return this.resolveAndPersist(rendererSettings(input, current.settings));
  }

  async retry(): Promise<DesktopConnectionSnapshot> {
    const current = await this.ensureInitialized();
    return this.resolveAndPersist(current.settings);
  }

  async resetDeploymentBinding(): Promise<DesktopConnectionSnapshot> {
    const current = await this.ensureInitialized();
    return this.resolveAndPersist({
      ...current.settings,
      deploymentId: null,
      activeSlot: null,
    });
  }

  private async ensureInitialized(): Promise<DesktopConnectionSnapshot> {
    return this.snapshot ?? this.initialize();
  }

  private async resolveAndPersist(
    settings: DesktopConnectionSettings,
  ): Promise<DesktopConnectionSnapshot> {
    const resolution = await this.resolver.resolve(settings);
    const finalized = normalizeConnectionSettings({
      ...settings,
      deploymentId: resolution.active?.deploymentId ?? settings.deploymentId,
      activeSlot: resolution.active?.slot ?? null,
    });
    const persisted = await this.store.save(finalized);
    this.snapshot = { settings: persisted, ...resolution };
    return this.snapshot;
  }
}

function rendererSettings(
  input: unknown,
  trusted: DesktopConnectionSettings,
): DesktopConnectionSettings {
  const candidate = typeof input === 'object' && input !== null ? input : {};
  return normalizeConnectionSettings({
    ...(candidate as Record<string, unknown>),
    deploymentId: trusted.deploymentId,
    activeSlot: trusted.activeSlot,
  });
}
