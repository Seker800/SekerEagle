export const EAGLE_EMBEDDING_DIMENSIONS = 1024;
export const EAGLE_EMBEDDING_MODEL = 'Qwen/Qwen3-VL-Embedding-2B';

export interface TagPrototypeCandidate {
  tagId: string;
  enabled: boolean;
  prototypes: number[][];
}

export interface TagSuggestionScore {
  tagId: string;
  score: number;
  distance: number;
  prototypeIndex: number;
}

export interface SphericalKMeansOptions {
  maxK?: number;
  minimumRelativeImprovement?: number;
  maxIterations?: number;
}

export interface SphericalKMeansResult {
  centers: number[][];
  assignments: number[];
  clusterSizes: number[];
  meanDistance: number;
}

const NORM_TOLERANCE = 1e-3;

export function normalizeEmbedding(vector: readonly number[]): number[] {
  if (!vector.length) throw new Error('Embedding dimension must be positive.');
  if (vector.some((value) => !Number.isFinite(value)))
    throw new Error('Embedding values must be finite.');
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm <= Number.EPSILON) throw new Error('Embedding cannot be a zero vector.');
  return vector.map((value) => value / norm);
}

export function validateEmbedding(vector: readonly number[], dimensions: number): number[] {
  if (vector.length !== dimensions)
    throw new Error(`Embedding dimension mismatch: expected ${dimensions}, received ${vector.length}.`);
  const normalized = normalizeEmbedding(vector);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (Math.abs(norm - 1) > NORM_TOLERANCE)
    throw new Error(`Embedding must be L2 normalized; received norm ${norm}.`);
  return normalized;
}

export function cosineDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0)
    throw new Error('Cosine distance requires equal positive dimensions.');
  const a = normalizeEmbedding(left);
  const b = normalizeEmbedding(right);
  const similarity = a.reduce((sum, value, index) => sum + value * b[index]!, 0);
  return Math.max(0, Math.min(2, 1 - similarity));
}

export function selectTopTagSuggestion(
  assetEmbedding: readonly number[],
  candidates: readonly TagPrototypeCandidate[],
  minimumScore: number,
): TagSuggestionScore | null {
  let best: TagSuggestionScore | null = null;
  for (const candidate of candidates) {
    if (!candidate.enabled || candidate.prototypes.length === 0) continue;
    for (let prototypeIndex = 0; prototypeIndex < candidate.prototypes.length; prototypeIndex += 1) {
      const prototype = candidate.prototypes[prototypeIndex]!;
      const distance = cosineDistance(assetEmbedding, prototype);
      const score = 1 - distance;
      if (
        !best ||
        score > best.score ||
        (score === best.score && candidate.tagId.localeCompare(best.tagId) < 0)
      ) {
        best = { tagId: candidate.tagId, score, distance, prototypeIndex };
      }
    }
  }
  return best && best.score >= minimumScore ? best : null;
}

export function sphericalKMeans(
  input: readonly (readonly number[])[],
  options: SphericalKMeansOptions = {},
): SphericalKMeansResult {
  if (input.length === 0) throw new Error('At least one embedding is required.');
  const dimensions = input[0]!.length;
  const vectors = input.map((vector) => validateCompatibleVector(vector, dimensions));
  const maxK = Math.max(1, Math.min(options.maxK ?? 8, vectors.length));
  const minimumRelativeImprovement = options.minimumRelativeImprovement ?? 0.12;
  let selected = runKMeans(vectors, 1, options.maxIterations ?? 50);
  let previousLoss = totalLoss(vectors, selected.centers, selected.assignments);
  for (let k = 2; k <= maxK; k += 1) {
    const candidate = runKMeans(vectors, k, options.maxIterations ?? 50);
    const candidateLoss = totalLoss(vectors, candidate.centers, candidate.assignments);
    const improvement = previousLoss <= Number.EPSILON ? 0 : (previousLoss - candidateLoss) / previousLoss;
    if (improvement <= minimumRelativeImprovement) break;
    selected = candidate;
    previousLoss = candidateLoss;
  }
  const clusterSizes = selected.centers.map(
    (_, centerIndex) => selected.assignments.filter((value) => value === centerIndex).length,
  );
  return {
    ...selected,
    clusterSizes,
    meanDistance: totalLoss(vectors, selected.centers, selected.assignments) / vectors.length,
  };
}

function validateCompatibleVector(vector: readonly number[], dimensions: number): number[] {
  if (vector.length !== dimensions) throw new Error('All embeddings must have equal dimensions.');
  return normalizeEmbedding(vector);
}

function runKMeans(vectors: number[][], k: number, maxIterations: number) {
  let centers = seedFarthestCenters(vectors, k);
  let assignments = vectors.map((vector) => nearestCenter(vector, centers));
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const nextCenters = centers.map((center, centerIndex) => {
      const members = vectors.filter((_, vectorIndex) => assignments[vectorIndex] === centerIndex);
      if (!members.length) return center;
      return normalizeEmbedding(
        center.map((_, dimension) =>
          members.reduce((sum, member) => sum + member[dimension]!, 0),
        ),
      );
    });
    const nextAssignments = vectors.map((vector) => nearestCenter(vector, nextCenters));
    centers = nextCenters;
    if (nextAssignments.every((value, index) => value === assignments[index])) {
      assignments = nextAssignments;
      break;
    }
    assignments = nextAssignments;
  }
  return { centers, assignments };
}

function seedFarthestCenters(vectors: number[][], k: number): number[][] {
  const centers = [vectors[0]!.slice()];
  while (centers.length < k) {
    let farthestIndex = 0;
    let farthestDistance = -1;
    vectors.forEach((vector, index) => {
      const distance = Math.min(...centers.map((center) => cosineDistance(vector, center)));
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    });
    centers.push(vectors[farthestIndex]!.slice());
  }
  return centers;
}

function nearestCenter(vector: number[], centers: number[][]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  centers.forEach((center, index) => {
    const distance = cosineDistance(vector, center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function totalLoss(vectors: number[][], centers: number[][], assignments: number[]): number {
  return vectors.reduce(
    (sum, vector, index) => sum + cosineDistance(vector, centers[assignments[index]!]!),
    0,
  );
}
