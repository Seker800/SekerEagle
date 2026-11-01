/** MIT MMCQ input boundary; the caller validates the external palette shape. */
export declare function quantize(
  rawBuffer: Uint8Array | Uint8ClampedArray,
  length: number,
  skip: number,
  alphaThreshold: number,
  maxcolors: number,
): unknown;
