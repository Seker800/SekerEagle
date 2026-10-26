export interface ComputeNodeSummary {
  id: string;
  name: string;
  accelerator: string;
  enabled: boolean;
  health: 'READY' | 'OFFLINE' | 'DRIFTED';
  concurrency: number;
  inFlight: number;
  operations: string[];
}
export interface ComputeRuntime {
  revision: number;
  backgroundLimit: number;
  nodes: ComputeNodeSummary[];
}
export function sanitizeComputeRuntime(value: unknown): ComputeRuntime | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as { backgroundLimit?: unknown; revision?: unknown; nodes?: unknown };
  if (
    !Number.isInteger(p.backgroundLimit) ||
    Number(p.backgroundLimit) < 0 ||
    Number(p.backgroundLimit) > 32 ||
    !Number.isSafeInteger(p.revision) ||
    !Array.isArray(p.nodes) ||
    p.nodes.length > 16
  )
    return null;
  const nodes: ComputeNodeSummary[] = [];
  for (const input of p.nodes) {
    const n = input as ComputeNodeSummary;
    if (
      !n ||
      typeof n.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,47}$/.test(n.id) ||
      typeof n.name !== 'string' ||
      n.name.length > 80 ||
      !['metal', 'cuda', 'cpu'].includes(n.accelerator) ||
      !['READY', 'OFFLINE', 'DRIFTED'].includes(n.health) ||
      typeof n.enabled !== 'boolean' ||
      !Number.isInteger(n.concurrency) ||
      n.concurrency < 1 ||
      n.concurrency > 8 ||
      !Number.isInteger(n.inFlight) ||
      n.inFlight < 0 ||
      n.inFlight > 8 ||
      !Array.isArray(n.operations) ||
      !n.operations.every((op) => ['embedding', 'image', 'faces'].includes(op))
    )
      return null;
    nodes.push({
      id: n.id,
      name: n.name,
      accelerator: n.accelerator,
      enabled: n.enabled,
      health: n.health,
      concurrency: n.concurrency,
      inFlight: n.inFlight,
      operations: [...n.operations],
    });
  }
  return { revision: Number(p.revision), backgroundLimit: Number(p.backgroundLimit), nodes };
}
