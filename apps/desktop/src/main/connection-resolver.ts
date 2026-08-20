import {
  configuredSlots,
  connectionUrl,
  type ConnectionSlot,
  type DesktopConnectionSettings,
} from './connection-config';

export type ConnectionProbeState =
  | 'AVAILABLE'
  | 'UNREACHABLE'
  | 'UNTRUSTED'
  | 'INCOMPATIBLE'
  | 'DIFFERENT_DEPLOYMENT';

export interface ConnectionProbeResult {
  state: ConnectionProbeState;
  url: string;
  latencyMs: number;
  deploymentId?: string;
  message?: string;
}

export interface SlotProbeResult extends ConnectionProbeResult {
  slot: ConnectionSlot;
}

export type ConnectionProbe = (
  slot: ConnectionSlot,
  url: string,
) => Promise<ConnectionProbeResult>;

export interface ActiveDesktopConnection {
  slot: ConnectionSlot;
  url: string;
  latencyMs: number;
  deploymentId: string;
}

export interface ConnectionResolution {
  active: ActiveDesktopConnection | null;
  probes: SlotProbeResult[];
}

export class DesktopConnectionResolver {
  constructor(private readonly probe: ConnectionProbe) {}

  async resolve(settings: DesktopConnectionSettings): Promise<ConnectionResolution> {
    const candidates =
      settings.mode === 'AUTO' ? configuredSlots(settings) : [settings.mode as ConnectionSlot];
    const sticky = settings.mode === 'AUTO' ? settings.activeSlot : null;
    const probes: SlotProbeResult[] = [];

    if (sticky && candidates.includes(sticky)) {
      const stickyProbe = await this.runProbe(sticky, connectionUrl(settings, sticky), settings);
      probes.push(stickyProbe);
      const active = activeConnection(stickyProbe);
      if (active) return { active, probes };
    }

    const remaining = candidates.filter((slot) => slot !== sticky);
    const fallbackProbes = await Promise.all(
      remaining.map((slot) => this.runProbe(slot, connectionUrl(settings, slot), settings)),
    );
    probes.push(...fallbackProbes);
    const active = fallbackProbes.map(activeConnection).find(Boolean) ?? null;
    return { active, probes };
  }

  private async runProbe(
    slot: ConnectionSlot,
    url: string,
    settings: DesktopConnectionSettings,
  ): Promise<SlotProbeResult> {
    let result: ConnectionProbeResult;
    try {
      result = await this.probe(slot, url);
    } catch {
      result = { state: 'UNREACHABLE', url, latencyMs: 0, message: '连接失败。' };
    }
    if (
      result.state === 'AVAILABLE' &&
      settings.deploymentId &&
      result.deploymentId !== settings.deploymentId
    ) {
      return {
        ...result,
        slot,
        state: 'DIFFERENT_DEPLOYMENT',
        message: '该地址属于另一套 SekerEagle 图库。',
      };
    }
    return { ...result, slot };
  }
}

function activeConnection(probe: SlotProbeResult): ActiveDesktopConnection | null {
  return probe.state === 'AVAILABLE' && probe.deploymentId
    ? {
        slot: probe.slot,
        url: probe.url,
        latencyMs: probe.latencyMs,
        deploymentId: probe.deploymentId,
      }
    : null;
}
