import type { EagleMediaJobKind } from '@prisma/client';
import { sanitizeComputeRuntime, type ComputeRuntime } from '@sekereagle/library-core';
export type { ComputeRuntime } from '@sekereagle/library-core';
export function parseComputeRuntime(value: unknown): ComputeRuntime | null {
  const p = value as {
    protocol?: unknown;
    fleet?: { revision?: unknown; nodes?: unknown };
    capacity?: { backgroundLimit?: unknown };
  } | null;
  return p?.protocol === 'sekereagle-compute-v1'
    ? sanitizeComputeRuntime({ ...p.fleet, backgroundLimit: p.capacity?.backgroundLimit })
    : null;
}
function operations(runtime: ComputeRuntime | null) {
  return (
    runtime?.nodes.filter((n) => n.enabled && n.health === 'READY').flatMap((n) => n.operations) ??
    []
  );
}
export function remoteImageKinds(runtime: ComputeRuntime | null): EagleMediaJobKind[] {
  const operations =
    runtime?.nodes.filter((n) => n.enabled && n.health === 'READY').flatMap((n) => n.operations) ??
    [];
  return [
    ...(operations.includes('image')
      ? ([
          'GENERATE_RENDITIONS',
          'GENERATE_THUMBNAIL',
          'GENERATE_PREVIEW',
          'PROBE_MEDIA',
          'EXTRACT_COLOR_PALETTE',
        ] as const)
      : []),
    ...(operations.includes('pyramid') ? (['GENERATE_IMAGE_PYRAMID'] as const) : []),
    ...(operations.includes('faces') ? (['ANALYZE_PHOTO_FACES'] as const) : []),
  ];
}
export function remoteVideoKinds(runtime: ComputeRuntime | null): EagleMediaJobKind[] {
  return operations(runtime).includes('video')
    ? ['GENERATE_RENDITIONS', 'GENERATE_THUMBNAIL', 'GENERATE_PREVIEW', 'PROBE_MEDIA']
    : [];
}
export function remoteMediaKinds(runtime: ComputeRuntime | null): EagleMediaJobKind[] {
  return [...new Set([...remoteImageKinds(runtime), ...remoteVideoKinds(runtime)])];
}

export function computePolicySignature(runtime: ComputeRuntime | null) {
  return JSON.stringify(
    runtime
      ? {
          revision: runtime.revision,
          backgroundLimit: runtime.backgroundLimit,
          nodes: runtime.nodes.map(({ id, enabled, health, concurrency, operations }) => ({
            id,
            enabled,
            health,
            concurrency,
            operations,
          })),
        }
      : null,
  );
}
