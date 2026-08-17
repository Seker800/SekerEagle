'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..');

test('uses the original compact desktop layout with the independent PAT boundary', async () => {
  const html = await fs.readFile(path.join(pluginRoot, 'index.html'), 'utf8');
  const requiredIds = [
    'connectionBadge', 'serverUrl', 'pat', 'connectButton', 'autoReconnect', 'autoSyncEnabled',
    'autoSyncTime', 'autoSyncStatus', 'libraryName', 'libraryPath', 'libraryBinding',
    'refreshLibrariesButton', 'prepareButton', 'uploadButton', 'resumeButton', 'pauseButton',
    'cancelButton', 'summaryCard', 'summaryTitle', 'summaryGrid', 'runStatus', 'progressLabel',
    'progressPercent', 'progressBar', 'log',
  ];

  assert.match(html, /class="app-toolbar"/);
  assert.match(html, /class="workspace-grid"/);
  assert.doesNotMatch(html, /id="(?:email|password|rememberPassword|loginButton)"/);
  for (const id of requiredIds) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
});

test('keeps the original restrained desktop density', async () => {
  const css = await fs.readFile(path.join(pluginRoot, 'styles.css'), 'utf8');
  const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'));
  assert.match(css, /--control-height:\s*30px/);
  assert.match(css, /\.status-panel\s*\{[^}]*grid-row:\s*5/s);
  assert.doesNotMatch(css, /radial-gradient|backdrop-filter|translateY|color-mix/);
  assert.equal(manifest.main.serviceMode, true);
});
