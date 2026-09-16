import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const eagleStyles = readFileSync(
  new URL('./components/eagle/SekerEaglePage.module.css', import.meta.url),
  'utf8',
);
const accountStyles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const processingStyles = readFileSync(
  new URL('./components/eagle/EagleProcessingPage.module.css', import.meta.url),
  'utf8',
);
const vectorStyles = readFileSync(
  new URL('./components/eagle/EagleVectorWorkspace.module.css', import.meta.url),
  'utf8',
);

test('settings use a native two-pane preference layout', () => {
  assert.match(
    eagleStyles,
    /\.settingsLibrary\s*\{[^}]*grid-template-columns:\s*190px minmax\(0,\s*1fr\)/s,
  );
  assert.match(eagleStyles, /\.settingsLibrary \.workspaceNavigation\s*\{[^}]*border-right:/s);
});

test('settings content is grouped by rhythm instead of nested cards', () => {
  assert.match(
    accountStyles,
    /\.account-panel\s*\{[^}]*border:\s*0;[^}]*border-top:[^}]*background:\s*transparent;/s,
  );
});

test('processing navigation is a compact toolbar instead of a card deck', () => {
  assert.match(
    processingStyles,
    /\.navigationBar\s*\{[^}]*width:\s*fit-content;[^}]*border:\s*1px[^}]*border-radius:/s,
  );
  assert.doesNotMatch(processingStyles, /\.tabs\s*\{[^}]*border:\s*1px/s);
});

test('asset cards keep their own height and truncate long metadata', () => {
  assert.match(vectorStyles, /\.assetCard\s*\{[^}]*align-self:\s*start;/s);
  assert.match(vectorStyles, /\.assetInfo strong\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(vectorStyles, /\.assetInfo span\s*\{[^}]*white-space:\s*nowrap;/s);
});

test('recommendation tag search uses a flat list instead of cards inside a card', () => {
  assert.match(
    vectorStyles,
    /\.tagSearch\s*\{[^}]*border:\s*0;[^}]*border-bottom:[^}]*background:\s*transparent;/s,
  );
  assert.match(vectorStyles, /\.tagCandidate\s*\{[^}]*min-height:\s*48px;[^}]*border:\s*0;/s);
  assert.doesNotMatch(vectorStyles, /\.tagCandidate\s*\{[^}]*border-radius:/s);
});
