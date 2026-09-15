import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(
  new URL('./components/eagle/SekerEaglePage.tsx', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('./components/eagle/SekerEaglePage.module.css', import.meta.url),
  'utf8',
);

test('smart folders scroll independently while primary workspace navigation stays visible', () => {
  assert.match(pageSource, /styles\.smartFolderSection/);
  assert.match(styles, /\.sidebar\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(
    styles,
    /\.smartFolderSection\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
  );
});
