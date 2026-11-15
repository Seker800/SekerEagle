import { cosineDistance, normalizeEmbedding, sphericalKMeans } from '@sekereagle/vector-core';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

export interface SampleEmbedding {
  assetId: string;
  embedding: number[];
}

export interface PrototypePlan {
  prototypes: Array<{
    rank: number;
    embedding: number[];
    memberCount: number;
    weight: number;
    meanDistance: number;
    p95Distance: number;
    representativeAssetIds: string[];
  }>;
}

export function parsePgVector(value: string, dimensions: number): number[] {
  if (!value.startsWith('[') || !value.endsWith(']')) throw new Error('Invalid vector encoding.');
  const parsed = value
    .slice(1, -1)
    .split(',')
    .filter((item) => item.length > 0)
    .map(Number);
  if (parsed.length !== dimensions)
    throw new Error(
      `Embedding dimension mismatch: expected ${dimensions}, received ${parsed.length}.`,
    );
  if (parsed.some((item) => !Number.isFinite(item)))
    throw new Error('Embedding values must be finite.');
  return normalizeEmbedding(parsed);
}

/** Keep the CPU-bound clustering off the worker's lease/heartbeat event loop. */
export function buildPrototypePlanOffThread(
  samples: SampleEmbedding[],
  options: { maxK?: number; minimumRelativeImprovement?: number } = {},
): Promise<PrototypePlan> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { prototypePlan: true, samples, options },
      execArgv: process.execArgv,
    });
    let settled = false;
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('TAG_PROTOTYPE_TIMEOUT'));
    }, 120_000);
    worker.once('message', (reply: { plan?: PrototypePlan; error?: string }) => {
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (reply.plan) resolve(reply.plan);
      else reject(new Error(reply.error ?? 'TAG_PROTOTYPE_FAILED'));
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      if (!settled) reject(error instanceof Error ? error : new Error(String(error)));
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (!settled) reject(new Error(`TAG_PROTOTYPE_EXIT:${code}`));
    });
  });
}

export function buildPrototypePlan(
  samples: SampleEmbedding[],
  options: { maxK?: number; minimumRelativeImprovement?: number } = {},
): PrototypePlan {
  if (!samples.length) throw new Error('At least one sample is required.');
  const clustered = sphericalKMeans(
    samples.map(({ embedding }) => embedding),
    {
      maxK: options.maxK ?? 8,
      minimumRelativeImprovement: options.minimumRelativeImprovement ?? 0.12,
    },
  );
  return prototypePlan(samples, clustered);
}

function prototypePlan(
  samples: SampleEmbedding[],
  clustered: ReturnType<typeof sphericalKMeans>,
): PrototypePlan {
  return {
    prototypes: clustered.centers.map((center, rank) => {
      const members = samples
        .map((sample, index) => ({
          ...sample,
          distance: cosineDistance(sample.embedding, center),
          assigned: clustered.assignments[index] === rank,
        }))
        .filter(({ assigned }) => assigned)
        .sort(
          (left, right) =>
            left.distance - right.distance || left.assetId.localeCompare(right.assetId),
        );
      const distances = members.map(({ distance }) => distance).sort((left, right) => left - right);
      const p95Index = Math.max(0, Math.ceil(distances.length * 0.95) - 1);
      return {
        rank,
        embedding: center,
        memberCount: members.length,
        weight: members.length / samples.length,
        meanDistance: distances.reduce((sum, value) => sum + value, 0) / distances.length,
        p95Distance: distances[p95Index] ?? 0,
        representativeAssetIds: members.slice(0, 5).map(({ assetId }) => assetId),
      };
    }),
  };
}

const workerTask = workerData as {
  prototypePlan?: boolean;
  samples?: SampleEmbedding[];
  options?: { maxK?: number; minimumRelativeImprovement?: number };
} | null;
if (!isMainThread && workerTask?.prototypePlan) {
  try {
    parentPort!.postMessage({ plan: buildPrototypePlan(workerTask.samples!, workerTask.options) });
  } catch (error) {
    parentPort!.postMessage({
      error: error instanceof Error ? error.message : 'TAG_PROTOTYPE_FAILED',
    });
  }
}
