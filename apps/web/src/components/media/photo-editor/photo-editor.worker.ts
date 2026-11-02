import init from '@silvia-odwyer/photon/photon_rs.js';
import wasmUrl from '@silvia-odwyer/photon/photon_rs_bg.wasm?url';
import type { PhotoEdits } from './photo-editor-model';
import { processPhotoPixels } from './photo-editor-photon';
import type { PhotoLut } from './photo-lut';

// Preview and saved pixels share the documented tone implementation + Photon presets.
// See docs/photo-editor.md for sources and application-specific calibration.
// Keep initialization rejection handled even before the first frame arrives.
const ready = Promise.resolve()
  .then(() => init({ module_or_path: wasmUrl }))
  .then(
    () => null,
    (error: unknown) =>
      error instanceof Error &&
      /content.security.policy|wasm code generation disallowed|unsafe-eval/i.test(error.message)
        ? ('PHOTO_WASM_BLOCKED' as const)
        : ('PHOTO_RENDER_FAILED' as const),
  );
interface RenderRequest {
  id: number;
  pixels: Uint8Array;
  width: number;
  height: number;
  edits: PhotoEdits;
  lut?: PhotoLut;
}
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  void render(event.data);
};
async function render({ id, pixels, width, height, edits, lut }: RenderRequest) {
  try {
    const failure = await ready;
    if (failure) {
      self.postMessage({ id, error: failure });
      return;
    }
    const output = processPhotoPixels(pixels, width, height, edits, lut);
    self.postMessage(
      { id, pixels: output, width, height },
      { transfer: [output.buffer as ArrayBuffer] },
    );
  } catch {
    self.postMessage({ id, error: 'PHOTO_RENDER_FAILED' });
  }
}
