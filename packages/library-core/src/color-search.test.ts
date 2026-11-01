import assert from 'node:assert/strict';
import test from 'node:test';
import { paletteColorScore, deltaE2000 } from './color-search';

const swatch = (hex: string, weight: number) => ({ hex, weight });

test('ordinary color filtering matches Eagle Build 23 area boundaries', () => {
  for (const whitePercent of [2, 3, 5, 10, 20, 25, 30, 33, 34, 40, 50, 60, 80, 95]) {
    const palette = [
      swatch('#040404', 1 - whitePercent / 100),
      swatch('#fcfcfc', whitePercent / 100),
    ].sort((a, b) => b.weight - a.weight);
    assert.equal(
      paletteColorScore('#ffffff', palette) !== null,
      whitePercent > 33,
      `${whitePercent}% white`,
    );
  }
});

test('white backgrounds admit a significant secondary subject with the Eagle penalty', () => {
  const palette = [swatch('#fcfcfc', 0.85), swatch('#0404fc', 0.15)];
  const score = paletteColorScore('#0000ff', palette);
  assert.ok(score !== null && Math.abs(score - 7.23606797749979) < 1e-10);
  assert.equal(paletteColorScore('#0000ff', [swatch('#040404', 0.85), palette[1]!]), null);
  assert.equal(
    paletteColorScore('#0000ff', [swatch('#fcfcfc', 0.92), swatch('#0404fc', 0.08)]),
    null,
  );
});

test('exact top-two matches retain Eagle exception and minimum dominant area', () => {
  assert.equal(
    paletteColorScore('#ffffff', [swatch('#000000', 0.95), swatch('#ffffff', 0.05)]),
    0.01,
  );
  assert.equal(
    paletteColorScore('#ffffff', [swatch('#040404', 0.95), swatch('#fcfcfc', 0.05)]),
    null,
  );
  assert.equal(
    paletteColorScore('#ffffff', [swatch('#ffffff', 0.24), swatch('#777777', 0.2)]),
    null,
  );
  assert.equal(paletteColorScore('#ffffff', []), null);
});

test('score is color distance rather than descending occupied area', () => {
  const lowArea = paletteColorScore('#ffffff', [swatch('#fcfcfc', 0.4), swatch('#aaaaaa', 0.35)]);
  const highArea = paletteColorScore('#ffffff', [swatch('#dddddd', 0.9), swatch('#040404', 0.1)]);
  assert.ok(lowArea !== null && highArea !== null && lowArea < highArea);
});

test('CIEDE2000 matches published Sharma reference pairs', () => {
  const reference: Array<[number[], number[], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  ];
  for (const [a, b, expected] of reference) {
    assert.ok(
      Math.abs(
        deltaE2000(a as [number, number, number], b as [number, number, number]) - expected,
      ) < 0.0001,
    );
  }
});

test('palette quantization preserves Eagle bin centers and avoids exact-white accent matches', async () => {
  const { extractSearchColors } = await import('./color-palette');
  const pixels = Uint8Array.from(
    Array.from({ length: 10000 }, (_, i) =>
      i < 500 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    ).flat(),
  );
  const palette = extractSearchColors(pixels, 4, 10000);
  assert.deepEqual(
    palette.map(({ hex, weight }) => ({ hex, weight })),
    [
      { hex: '#040404', weight: 0.95 },
      { hex: '#fcfcfc', weight: 0.05 },
    ],
  );
  assert.equal(paletteColorScore('#ffffff', palette), null);
  assert.deepEqual(extractSearchColors(Uint8Array.from([255, 255, 255, 169]), 4, 1), []);
});

test('palette input and alpha boundaries preserve basic processing safety', async () => {
  const { extractSearchColors } = await import('./color-palette');
  assert.throws(() => extractSearchColors(new Uint8Array(2), 2, 1), /RGB/);
  assert.throws(() => extractSearchColors(new Uint8Array(3), 4, 1), /RGB/);
  assert.deepEqual(extractSearchColors(new Uint8Array(), 4, 0), []);
  assert.equal(extractSearchColors(Uint8Array.from([255, 0, 0]), 3, 1)[0]?.hex, '#fc0404');
  assert.equal(extractSearchColors(Uint8Array.from([255, 255, 255, 170]), 4, 1)[0]?.hex, '#fcfcfc');
  assert.throws(() => paletteColorScore('white', [{ hex: '#ffffff', weight: 1 }]), /Invalid hex/);
});

test('matches portable golden scores captured from Eagle Build 23 without requiring Eagle in CI', async () => {
  const golden = await import('./fixtures/eagle-basic-color.json');
  assert.equal(golden.reference.build, 23);
  for (const row of golden.cases) {
    const score = paletteColorScore(row.target, row.palette);
    if (row.score === null) assert.equal(score, null);
    else assert.ok(score !== null && Math.abs(score - row.score) < 1e-9);
  }
});

test('color rank distances retain the same rounded-Lab square-root arithmetic as SQL cursors', () => {
  assert.equal(paletteColorScore('#777777', [{ hex: '#69696a', weight: 1 }]), Math.sqrt(37));
});
