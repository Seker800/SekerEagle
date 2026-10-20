import assert from 'node:assert/strict';
import test from 'node:test';
import { inferCity, filenameSignals, haversineKm } from './photo-agent-rules';

const city = {
  id: 'cn-zj-hangzhou',
  name: '杭州市',
  country: '中国',
  region: '浙江省',
  latitude: 30.25,
  longitude: 120.15,
};
const time = Date.parse('2026-10-01T10:00:00Z');
const anchor = (id: string, minutes: number, override = {}) => ({
  id,
  capturedAt: new Date(time + minutes * 60000),
  latitude: 30.25,
  longitude: 120.15,
  cityId: city.id,
  ...override,
});
test('city inference requires bracketing nearby consistent anchors and known time', () => {
  const result = inferCity(new Date(time), true, [anchor('a', -5), anchor('b', 5)], [city], 0);
  assert.equal(result?.city.id, city.id);
  assert.deepEqual(result?.evidenceIds, ['a', 'b']);
  assert.equal(
    inferCity(new Date(time), false, [anchor('a', -5), anchor('b', 5)], [city], 0),
    null,
  );
  assert.equal(inferCity(null, true, [anchor('a', -5), anchor('b', 5)], [city], 0), null);
  assert.equal(inferCity(new Date(time), true, [anchor('a', -5)], [city], 0), null);
});
test('city inference abstains for conflicting cities, sparse points, distant points and reused anchor', () => {
  for (const anchors of [
    [anchor('a', -5), anchor('b', 5, { cityId: 'other' })],
    [anchor('a', -60), anchor('b', 60)],
    [anchor('a', -5), anchor('b', 5, { longitude: 121 })],
    [anchor('a', -5), anchor('a', 5)],
  ])
    assert.equal(inferCity(new Date(time), true, anchors, [city], 0), null);
});
test('explicit clock correction is scoped input and cannot authorize unknown timezone', () => {
  const result = inferCity(
    new Date(time - 7 * 60000),
    true,
    [anchor('a', -2), anchor('b', 2)],
    [city],
    420,
  );
  assert.equal(result?.city.id, city.id);
  assert.equal(
    inferCity(new Date(time), true, [anchor('a', -2), anchor('b', 2)], [city], Infinity),
    null,
  );
});
test('filename signals nominate screenshots without treating missing EXIF, camera names or videos as non-photos', () => {
  assert.deepEqual(filenameSignals('Screenshot_20261001.png', 'image/png'), ['SCREENSHOT_NAME']);
  assert.deepEqual(filenameSignals('截屏2026.png', 'image/png'), ['SCREENSHOT_NAME']);
  for (const name of ['IMG_0001.jpg', 'DSC_0001.NEF', 'a poster at home.jpg', 'photo.png'])
    assert.deepEqual(filenameSignals(name, 'image/jpeg'), []);
  assert.deepEqual(filenameSignals('Screenshot.mp4', 'video/mp4'), []);
});
test('distance calculation handles identical points and antimeridian', () => {
  assert.equal(haversineKm(30, 120, 30, 120), 0);
  assert.ok(haversineKm(0, 179.99, 0, -179.99) < 3);
});
