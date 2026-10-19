import init from '@silvia-odwyer/photon/photon_rs.js';
import wasmUrl from '@silvia-odwyer/photon/photon_rs_bg.wasm?url';
import type { PhotoEdits } from './photo-editor-model';
import { processPhotoPixels } from './photo-editor-photon';

// Preview and saved pixels share the documented tone implementation + Photon presets.
// See docs/photo-editor.md for sources and application-specific calibration.
const ready = init({ module_or_path: wasmUrl });
interface RenderRequest {
  id: number;
  pixels: Uint8Array;
  width: number;
  height: number;
  edits: PhotoEdits;
}
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  void render(event.data);
};
async function render({ id, pixels, width, height, edits }: RenderRequest) {
  try {
    await ready;
    const output = processPhotoPixels(pixels, width, height, edits);
    self.postMessage(
      { id, pixels: output, width, height },
      { transfer: [output.buffer as ArrayBuffer] },
    );
  } catch {
    self.postMessage({ id, error: true });
  }
}
