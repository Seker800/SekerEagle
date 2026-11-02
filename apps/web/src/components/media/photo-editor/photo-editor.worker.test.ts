import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';
const mocks = vi.hoisted(() => ({ init: vi.fn(), pixels: vi.fn() }));
vi.mock('@silvia-odwyer/photon/photon_rs.js', () => ({ default: mocks.init }));
vi.mock('./photo-editor-photon', () => ({ processPhotoPixels: mocks.pixels }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('reports blocked WASM as an actionable client compatibility failure', async () => {
  let reject!: (reason: Error) => void;
  mocks.init.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  const scope = { onmessage: null as null | ((event: unknown) => void), postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('./photo-editor.worker');
  scope.onmessage!({
    data: { id: 1, pixels: new Uint8Array(4), width: 1, height: 1, edits: DEFAULT_PHOTO_EDITS },
  });
  reject(
    new WebAssembly.CompileError(
      "Refused to compile WebAssembly because 'unsafe-eval' violates Content Security Policy",
    ),
  );
  await vi.waitFor(() =>
    expect(scope.postMessage).toHaveBeenCalledWith({ id: 1, error: 'PHOTO_WASM_BLOCKED' }),
  );
  expect(mocks.pixels).not.toHaveBeenCalled();
});
