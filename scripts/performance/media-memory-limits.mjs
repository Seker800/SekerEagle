/** Viewer budgets are derivative-sized; full-frame worker decoders have separate limits. */
export const mediaMemoryLimits = {
  requiredMeasurements: [
    'viewer-preview-50mp',
    'palette-50mp',
    'pyramid-viewer-50mp',
    'viewer-preview-120mp',
    'palette-120mp',
    'pyramid-viewer-120mp',
    'worker-preview-jpeg-120mp',
    'worker-preview-png-120mp',
    'worker-preview-heif-64mp',
  ],
  maximumPeakRssMiB: {
    'viewer-preview-50mp': 256,
    'palette-50mp': 192,
    'pyramid-viewer-50mp': 320,
    'viewer-preview-120mp': 256,
    'palette-120mp': 192,
    'pyramid-viewer-120mp': 320,
    'worker-preview-jpeg-120mp': 1536,
    'worker-preview-png-120mp': 1536,
    'worker-preview-heif-64mp': 1536,
  },
  maximumOriginalGetCount: {
    'viewer-preview-50mp': 0,
    'palette-50mp': 0,
    'pyramid-viewer-50mp': 0,
    'viewer-preview-120mp': 0,
    'palette-120mp': 0,
    'pyramid-viewer-120mp': 0,
  },
};
