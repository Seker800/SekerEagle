/** MIT MMCQ input and output contract. */
export interface QuantizedPalette {
  cmap: { palette(): Array<{ color: number[]; count: number }> };
  pixelCount: number;
}
export declare function quantize(
  rawBuffer: Uint8Array | Uint8ClampedArray,
  length: number,
  skip: number,
  alphaThreshold: number,
  maxcolors: number,
): QuantizedPalette | false;
