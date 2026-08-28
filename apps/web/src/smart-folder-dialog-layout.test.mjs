import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dialogStyles = await readFile(
  new URL('./components/eagle/EagleSmartFolderDialog.module.css', import.meta.url),
  'utf8',
);
const ruleStyles = await readFile(
  new URL('./components/eagle/EagleRuleBuilder.module.css', import.meta.url),
  'utf8',
);

test('smart-folder dialog uses a spacious non-blurred canvas', () => {
  const backdropRule = dialogStyles.match(/\.backdrop\s*\{[^}]*\}/s)?.[0] ?? '';
  const dialogRule = dialogStyles.match(/\.dialog\s*\{[^}]*\}/s)?.[0] ?? '';

  assert.doesNotMatch(backdropRule, /backdrop-filter\s*:/);
  assert.match(dialogRule, /width:\s*min\(1440px,\s*calc\(100vw - 48px\)\)/);
  assert.match(dialogRule, /height:\s*min\(900px,\s*calc\(100dvh - 48px\)\)/);
});

test('tag choices expand inside the scrollable dialog instead of being clipped at its edge', () => {
  const tagMenuRule = ruleStyles.match(/\.tagMenu\s*\{[^}]*\}/s)?.[0] ?? '';

  assert.match(tagMenuRule, /position:\s*static/);
  assert.doesNotMatch(tagMenuRule, /^\s*top\s*:/m);
  assert.doesNotMatch(tagMenuRule, /^\s*left\s*:/m);
});
