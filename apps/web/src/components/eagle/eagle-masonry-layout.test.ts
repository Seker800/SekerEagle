import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildEagleMasonryLayout } from './eagle-masonry-layout';
import {
  buildMasonryViewportIndex,
  selectVisibleMasonryItemsFromIndex,
} from '../media/masonry-layout';

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

  it('keeps the rendered viewport bounded for a 100k asset layout', () => {
    const assets = Array.from({ length: 100_000 }, (_, index) => ({
      id: `scale-${index}`,
      width: 640 + (index % 3_200),
      height: 480 + (index % 2_400),
    }));
    const startedAt = performance.now();
    const layout = buildEagleMasonryLayout(assets, 1_440, { targetCardWidth: 210 });
    const index = buildMasonryViewportIndex(layout.items);
    const visible = selectVisibleMasonryItemsFromIndex(index, {
      scrollTop: Math.floor(layout.height / 2),
      viewportHeight: 900,
      overscan: 1_800,
    });

    expect(layout.items).toHaveLength(100_000);
    expect(visible.length).toBeLessThan(200);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});

it('lays justified rows left to right at equal height without cropping or horizontal overflow', () => {
  const assets = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    width: i % 2 ? 400 : 800,
    height: 600,
  }));
  const layout = buildEagleMasonryLayout(assets, 900, {
    strategy: 'justified',
    targetCardWidth: 180,
  });
  expect(layout.items.map((x) => x.id)).toEqual(assets.map((x) => x.id));
  const firstRow = layout.items.filter((x) => x.top === 0);
  expect(firstRow.length).toBeGreaterThan(1);
  expect(new Set(firstRow.map((x) => x.height)).size).toBe(1);
  expect(firstRow.at(-1)!.left + firstRow.at(-1)!.width).toBeCloseTo(900, 5);
  for (const item of layout.items) {
    const asset = assets.find((x) => x.id === item.id)!;
    expect((item.width - 2) / item.previewHeight).toBeCloseTo(asset.width / asset.height, 5);
    expect(item.left + item.width).toBeLessThanOrEqual(900.00001);
    expect(item.height).toBeGreaterThan(0);
  }
});

it('keeps justified empty, narrow and partial rows finite and within the viewport', () => {
  expect(buildEagleMasonryLayout([], 900, { strategy: 'justified' }).height).toBe(0);
  for (const width of [0, 30, 400, 1200]) {
    const layout = buildEagleMasonryLayout(
      [
        { id: 'a', width: null, height: null },
        { id: 'b', width: -1, height: 40 },
        { id: 'c', width: 100000, height: 1 },
      ],
      width,
      { strategy: 'justified' },
    );
    for (const item of layout.items) {
      expect(Number.isFinite(item.height)).toBe(true);
      expect(item.height).toBeGreaterThan(0);
      expect(item.left + item.width).toBeLessThanOrEqual(Math.max(3, width) + 0.0001);
    }
  }
  const last = buildEagleMasonryLayout([{ id: 'one', width: 400, height: 400 }], 1200, {
    strategy: 'justified',
    targetCardWidth: 210,
  });
  expect(last.items[0].width).toBe(212);
});

it('reserves full-width section headings and starts a new row at each section boundary', () => {
  const assets = ['october-a', 'october-b', 'march', 'previous-year'].map((id) => ({
    id,
    width: 800,
    height: 600,
  }));
  const sectionKeys = new Map([
    ['october-a', '2026-10'],
    ['october-b', '2026-10'],
    ['march', '2026-03'],
    ['previous-year', '2025-12'],
  ]);
  const layout = buildEagleMasonryLayout(assets, 900, { strategy: 'justified', sectionKeys });
  expect(layout.sections.map((section) => section.key)).toEqual(['2026-10', '2026-03', '2025-12']);
  expect(layout.items[0].top).toBe(layout.sections[0].top + layout.sections[0].height);
  expect(layout.items[1].top).toBe(layout.items[0].top);
  for (let index = 1; index < layout.sections.length; index++) {
    const heading = layout.sections[index];
    const next = layout.items.find((item) => sectionKeys.get(item.id) === heading.key)!;
    expect(next.left).toBe(0);
    expect(next.top).toBe(heading.top + heading.height);
    const previous = layout.items.filter((item) => item.top < heading.top);
    expect(previous.every((item) => item.top + item.height <= heading.top)).toBe(true);
  }
  expect(layout.height).toBeGreaterThan(layout.items.at(-1)!.top);
});

it('keeps a month continuous when the next page adds more photos and virtualizes its heading', () => {
  const assets = Array.from({ length: 500 }, (_, index) => ({
    id: `item-${index}`,
    width: 800,
    height: 600,
  }));
  const sectionKeys = new Map(assets.map((asset) => [asset.id, '2026-10']));
  const first = buildEagleMasonryLayout(assets.slice(0, 20), 900, {
    strategy: 'justified',
    sectionKeys,
  });
  const all = buildEagleMasonryLayout(assets, 900, { strategy: 'justified', sectionKeys });
  expect(first.sections).toHaveLength(1);
  expect(all.sections).toHaveLength(1);
  const index = buildMasonryViewportIndex(all.sections);
  expect(
    selectVisibleMasonryItemsFromIndex(index, { scrollTop: 0, viewportHeight: 600, overscan: 100 }),
  ).toHaveLength(1);
  expect(
    selectVisibleMasonryItemsFromIndex(index, {
      scrollTop: 10_000,
      viewportHeight: 600,
      overscan: 100,
    }),
  ).toHaveLength(0);
});

it('does not add headings or change the existing material layout without section metadata', () => {
  const asset = { id: 'one', width: 800, height: 600 };
  expect(buildEagleMasonryLayout([asset], 900).sections).toEqual([]);
  expect(buildEagleMasonryLayout([asset], 900, { strategy: 'justified' }).sections).toEqual([]);
  expect(
    buildEagleMasonryLayout([], 900, { strategy: 'justified', sectionKeys: new Map() }).sections,
  ).toEqual([]);
});

it('uses three square columns and never fills the last row across a date boundary', () => {
 const assets=Array.from({length:5},(_,i)=>({id:String(i),width:100,height:200}));
 const result=buildEagleMasonryLayout(assets,390,{strategy:'square',sectionKeys:new Map([['0','2026-10-21'],['1','2026-10-21'],['2','2026-10-21'],['3','2026-10-21'],['4','2026-10-20']])});
 expect(result.columns).toBe(3); expect(result.items[0].width).toBe(result.items[0].height);
 expect(result.items[2].top).toBe(result.items[0].top); expect(result.items[3].left).toBe(0);
 expect(result.sections).toHaveLength(2);expect(result.items[4].top).toBeGreaterThan(result.items[3].top+result.items[3].height);
 expect(result.items[4].left).toBe(0);
});
