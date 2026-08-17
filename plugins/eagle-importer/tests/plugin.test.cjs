'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('独立导入器复用原版恢复引擎并只使用 PAT', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'plugin.js'), 'utf8');
  assert.equal(source.includes('/auth/token/login'), false);
  assert.equal(source.includes('SekerChat'), false);
  assert.equal(source.includes("'/auth/me'"), true);
  assert.equal(source.includes("require(path.join(jsPath, 'import-engine.js'))"), true);
  assert.equal(source.includes("require(path.join(jsPath, 'automation.js'))"), true);
  assert.equal(source.includes("pat.startsWith('se_pat_')"), true);
});

test('manifest 使用独立插件身份', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'SekerEagle 独立导入器');
  assert.equal(manifest.version, '2.0.0');
});
