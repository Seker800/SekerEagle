import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const schema = JSON.parse(readFileSync(new URL('../openapi.json',import.meta.url),'utf8'));
for (const mode of ['eagle','photos']) {
  for (const suffix of ['', '/content']) {
    const path = `/api/${mode}/assets/{assetId}/renditions/{renditionId}${suffix}`;
    test(`${path} permits playback with or without a Range header`, () => {
      const header = schema.paths[path].get.parameters.find((parameter)=>parameter.in === 'header' && parameter.name === 'range');
      assert.ok(header);
      assert.equal(header.required,false);
    });
  }
}
