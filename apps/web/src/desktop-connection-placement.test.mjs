import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

test('desktop connection controls stay in the lower-right safe area', () => {
  const rule = styles.match(/\.desktop-connection-controls\s*\{(?<body>[\s\S]*?)\}/u)?.groups?.body;
  assert.ok(rule);
  assert.match(rule, /bottom:\s*18px/u);
  assert.match(rule, /right:\s*18px/u);
  assert.doesNotMatch(rule, /top:/u);
});
