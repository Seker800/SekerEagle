import { PermanentMediaValidationError } from './media-validation-error';
import { PHOTO_FACE_MODEL_VERSION } from '@sekereagle/library-core';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
export const FACE_MODEL_VERSION = PHOTO_FACE_MODEL_VERSION;
const INFERENCE_TIMEOUT_MS = 120_000;
const IDLE_TIMEOUT_MS = 10 * 60_000;
export interface FaceDetection {
  box: number[];
  confidence: number;
  embedding: number[];
}
export function cosineSimilarity(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length || !a.length) return -1;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! ** 2;
    bb += b[i]! ** 2;
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : -1;
}
export function validateFaceResult(value: unknown): FaceDetection[] {
  if (!value || typeof value !== 'object') throw new Error('FACE_RESULT_INVALID');
  const result = value as { version?: unknown; faces?: unknown };
  if (
    result.version !== FACE_MODEL_VERSION ||
    !Array.isArray(result.faces) ||
    result.faces.length > 128
  )
    throw new Error('FACE_RESULT_INVALID');
  return result.faces.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('FACE_RESULT_INVALID');
    const face = entry as FaceDetection;
    if (
      !Array.isArray(face.box) ||
      face.box.length !== 4 ||
      !face.box.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ||
      !Array.isArray(face.embedding) ||
      face.embedding.length !== 128 ||
      !face.embedding.every((x) => Number.isFinite(x) && Math.abs(x) <= 1.001) ||
      !Number.isFinite(face.confidence) ||
      face.confidence < 0 ||
      face.confidence > 1
    )
      throw new Error('FACE_RESULT_INVALID');
    if (Math.abs(cosineSimilarity(face.embedding, face.embedding) - 1) > 0.01)
      throw new Error('FACE_RESULT_INVALID');
    return face;
  });
}

interface PendingInference {
  resolve: (faces: FaceDetection[]) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}
interface InferenceServer {
  child: ChildProcessWithoutNullStreams;
  key: string;
  nextId: number;
  buffer: string;
  stderr: string;
  pending: Map<number, PendingInference>;
  idle?: NodeJS.Timeout;
}
let server: InferenceServer | undefined;

function configuration() {
  if (!process.env.PHOTO_FACE_PYTHON || !process.env.PHOTO_FACE_MODEL_DIR)
    throw new Error('PHOTO_FACE_RUNTIME_NOT_CONFIGURED');
  return {
    python: process.env.PHOTO_FACE_PYTHON,
    modelDir: resolve(process.env.PHOTO_FACE_MODEL_DIR),
    script: resolve(process.env.PHOTO_FACE_SCRIPT ?? 'services/photo-face/infer.py'),
  };
}

function settle(state: InferenceServer, id: number, message: Record<string, unknown>) {
  const pending = state.pending.get(id);
  if (!pending) return;
  state.pending.delete(id);
  clearTimeout(pending.timer);
  if (typeof message.error === 'string') {
    pending.reject(
      message.error === 'PHOTO_FACE_INPUT_INVALID'
        ? new PermanentMediaValidationError('IMAGE_DECODE_FAILED')
        : message.error === 'PHOTO_FACE_INPUT_TOO_LARGE'
          ? new PermanentMediaValidationError('IMAGE_PIXEL_LIMIT_EXCEEDED')
          : new Error(message.error),
    );
  } else {
    try {
      pending.resolve(validateFaceResult(message));
    } catch (error) {
      pending.reject(error);
    }
  }
  if (!state.pending.size) {
    if (state.idle) clearTimeout(state.idle);
    state.idle = setTimeout(() => {
      if (server === state && !state.pending.size) stopFaceInference();
    }, IDLE_TIMEOUT_MS);
    state.idle.unref();
  }
}

function drain(state: InferenceServer) {
  let index: number;
  while ((index = state.buffer.indexOf('\n')) >= 0) {
    const line = state.buffer.slice(0, index).trim();
    state.buffer = state.buffer.slice(index + 1);
    if (!line) continue;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof message.id === 'number') settle(state, message.id, message);
  }
}

function ensureServer(config: ReturnType<typeof configuration>): InferenceServer {
  const key = JSON.stringify([config.python, config.modelDir, config.script]);
  if (server && server.key === key && !server.child.killed) return server;
  stopFaceInference();
  const child = spawn(config.python, [config.script, config.modelDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      OPENCV_IO_MAX_IMAGE_PIXELS: '40000000',
      OMP_NUM_THREADS: '1',
    },
  });
  const created: InferenceServer = {
    child,
    key,
    nextId: 1,
    buffer: '',
    stderr: '',
    pending: new Map(),
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    created.buffer += chunk;
    drain(created);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    created.stderr = (created.stderr + chunk).slice(-4096);
  });
  const fail = (error: unknown) => {
    for (const pending of created.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    created.pending.clear();
    if (created.idle) clearTimeout(created.idle);
    if (server === created) server = undefined;
  };
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    const detail =
      created.stderr.trim() || `PHOTO_FACE_RUNTIME_EXIT_${code ?? signal ?? 'UNKNOWN'}`;
    fail(new Error(detail));
  });
  server = created;
  return created;
}

/** Stop the shared inference process; the next call starts a fresh one. */
export function stopFaceInference(): void {
  const state = server;
  server = undefined;
  if (!state) return;
  if (state.idle) clearTimeout(state.idle);
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('PHOTO_FACE_RUNTIME_STOPPED'));
  }
  state.pending.clear();
  state.child.kill();
}

export async function inferPhotoFaces(bytes: Buffer): Promise<FaceDetection[]> {
  const config = configuration();
  if (bytes.length > 20 * 1024 * 1024)
    throw new PermanentMediaValidationError(
      'IMAGE_PIXEL_LIMIT_EXCEEDED',
      'PHOTO_FACE_INPUT_TOO_LARGE',
    );
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-faces-'));
  try {
    const image = join(directory, 'preview.jpg');
    await writeFile(image, bytes, { flag: 'wx' });
    const state = ensureServer(config);
    return await new Promise<FaceDetection[]>((resolveInference, rejectInference) => {
      const id = state.nextId++;
      const timer = setTimeout(() => {
        if (!state.pending.delete(id)) return;
        rejectInference(new Error('PHOTO_FACE_TIMEOUT'));
        // One slow photo must not fail the rest of the batch; retire the shared
        // process only once nothing else is waiting on it.
        if (server === state && !state.pending.size) stopFaceInference();
      }, INFERENCE_TIMEOUT_MS);
      timer.unref();
      state.pending.set(id, { resolve: resolveInference, reject: rejectInference, timer });
      state.child.stdin.write(`${JSON.stringify({ id, path: image })}\n`, (error) => {
        if (!error) return;
        const pending = state.pending.get(id);
        if (!pending) return;
        state.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error);
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
