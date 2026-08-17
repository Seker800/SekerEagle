import { describe, expect, it } from 'vitest';
import { buildEagleMasonryLayout } from './eagle-masonry-layout';

describe('buildEagleMasonryLayout', () => {
  it('keeps every card position stable when selection changes outside the layout inputs', () => {
    const assets = [
      { id: 'wide', width: 960, height: 320 },
      { id: 'tall', width: 320, height: 960 },
      { id: 'square', width: 720, height: 720 },
      { id: 'landscape', width: 840, height: 420 },
      { id: 'portrait', width: 420, height: 840 },
      { id: 'fallback', width: null, height: null },
    ];

    const beforeSelection = buildEagleMasonryLayout(assets, 766);
    const afterSelection = buildEagleMasonryLayout(assets, 766);

    expect(afterSelection).toEqual(beforeSelection);
    expect(beforeSelection.columns).toBe(3);
    expect(beforeSelection.items.map((item) => item.id)).toEqual(assets.map((asset) => asset.id));
    expect(new Set(beforeSelection.items.map((item) => item.column)).size).toBe(3);
  });

  it('uses deterministic single-column positions at narrow widths', () => {
    const layout = buildEagleMasonryLayout(
      [
        { id: 'one', width: 800, height: 400 },
        { id: 'two', width: 400, height: 800 },
      ],
      180,
    );

    expect(layout.columns).toBe(1);
    expect(layout.items[0]).toMatchObject({ id: 'one', column: 0, left: 0, top: 0 });
    expect(layout.items[1].top).toBeGreaterThan(layout.items[0].top);
  });

  it('sizes every card to the image preview without a metadata row', () => {
    const layout = buildEagleMasonryLayout([{ id: 'square', width: 800, height: 800 }], 210, {
      targetCardWidth: 210,
    });

    expect(layout.items[0]).toMatchObject({ width: 210, height: 210, previewHeight: 208 });
    expect(layout.height).toBe(210);
  });

  it('uses the selected thumbnail size to change the grid density', () => {
    const assets = Array.from({ length: 8 }, (_, index) => ({
      id: String(index),
      width: 800,
      height: 800,
    }));

    const dense = buildEagleMasonryLayout(assets, 900, {
      targetCardWidth: 140,
    });
    const spacious = buildEagleMasonryLayout(assets, 900, {
      targetCardWidth: 320,
    });

    expect(dense.columns).toBeGreaterThan(spacious.columns);
    expect(dense.items[0].height - dense.items[0].previewHeight).toBe(2);
    expect(spacious.items[0].height - spacious.items[0].previewHeight).toBe(2);
  });

  it('fits every card inside the narrower width left by the inspector', () => {
    const layout = buildEagleMasonryLayout(
      [
        { id: 'one', width: 800, height: 600 },
        { id: 'two', width: 600, height: 800 },
        { id: 'three', width: 1200, height: 600 },
      ],
      480,
    );

    expect(layout.columns).toBe(3);
    expect(Math.max(...layout.items.map((item) => item.left + item.width))).toBeCloseTo(480);
  });

  it('caps oversized thumbnail preferences in a compact library pane', () => {
    const layout = buildEagleMasonryLayout(
      [
        { id: 'one', width: 800, height: 600 },
        { id: 'two', width: 600, height: 800 },
      ],
      450,
      { targetCardWidth: 320 },
    );

    expect(layout.columns).toBe(2);
  });

  it('keeps column assignments stable across subpixel container width noise', () => {
    const assets = [1.158224, 0.579603, 4.127633, 0.204057, 1.729095].map((ratio, index) => ({
      id: `asset-${index}`,
      width: 1_000_000,
      height: Math.round(1_000_000 * ratio),
    }));

    const beforeNoise = buildEagleMasonryLayout(assets, 657.45);
    const afterNoise = buildEagleMasonryLayout(assets, 657.55);

    expect(beforeNoise.columns).toBe(3);
    expect(afterNoise.columns).toBe(3);
    expect(afterNoise.items.map((item) => item.column)).toEqual(
      beforeNoise.items.map((item) => item.column),
    );
  });
});
