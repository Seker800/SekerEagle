import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEFAULT_PHOTO_EDITS } from '../../packages/library-core/dist/index.js';
const require = createRequire(import.meta.url);
const { _electron } = require(
  process.env.SEKEREAGLE_PLAYWRIGHT_MODULE ??
    join(
      homedir(),
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const root = process.cwd(),
  out = resolve('.omx/artifacts/desktop-018-acceptance');
const w = JSON.parse(await readFile(resolve('.omx/artifacts/desktop-018-workbench.json'), 'utf8'));
assert.equal(w.basic, true);
assert.ok(['localhost', '127.0.0.1'].includes(new URL(w.origin).hostname));
assert.ok(
  w.containers.every((name) => /^sekereagle-photo-workbench-[a-f0-9]{8}-(db|storage)$/.test(name)),
);
process.kill(w.pid, 0);
await mkdir(out, { recursive: true });
const profile = join(out, 'profile'),
  appDir = join(out, 'app');
for (const name of ['home', 'appData', 'userData', 'temp'])
  await mkdir(join(profile, name), { recursive: true });
await mkdir(appDir, { recursive: true });
const manifest = JSON.parse(await readFile('apps/desktop/package.json', 'utf8'));
await writeFile(
  join(appDir, 'package.json'),
  JSON.stringify({ name: 'desktop-regression', version: manifest.version, main: 'entry.cjs' }),
);
await writeFile(
  join(appDir, 'entry.cjs'),
  `const {app}=require('electron');for(const key of ['home','appData','userData','temp']) app.setPath(key,process.getBuiltinModule('path').join(${JSON.stringify(profile)},key));require(${JSON.stringify(join(root, 'apps/desktop/dist/main.cjs'))});`,
);
const env = { ...process.env, SEKEREAGLE_SERVER_URL: w.origin };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
try {
  desktop = await _electron.launch({
    executablePath: require('electron'),
    args: [appDir],
    env,
    timeout: 30000,
  });
  const page = await desktop.firstWindow();
  await page.goto(w.loginUrl);
  await page.getByRole('button', { name: '照片', exact: true }).waitFor({ timeout: 30000 });
  assert.equal(
    (await page.evaluate(() => globalThis.sekerDesktop.getAppInfo())).version,
    manifest.version,
  );
  await desktop.evaluate(({ BrowserWindow }) => {
    globalThis.testDrags = [];
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.startDrag = (input) => {
        globalThis.testDrags.push(
          input.files.map((file) => ({
            name: process.getBuiltinModule('path').basename(file),
            hash: process
              .getBuiltinModule('crypto')
              .createHash('sha256')
              .update(process.getBuiltinModule('fs').readFileSync(file))
              .digest('hex'),
          })),
        );
      };
  });
  const modes = [];
  const layoutChecks = [];
  const checkHeader = (dialog) =>
    dialog
      .locator('header')
      .first()
      .evaluate((header) => {
        const rect = header.getBoundingClientRect();
        const hit = globalThis.document.elementFromPoint(rect.left + rect.width / 2, rect.top + 12);
        return { visible: header.contains(hit), top: rect.top, bottom: rect.bottom };
      });
  // Reproduce the old Windows title bar in Chromium, including its viewport overlay.
  // The fixed overlays ignored body margin and rendered behind this drag region.
  const oldWindowsCss = `body { height: calc(100vh - 32px) !important; margin-top: 32px !important; }
    body::before { content: ''; position: fixed; inset: 0 138px auto 0;
      height: 32px; z-index: 2147483647; background: #1b1c1f; -webkit-app-region: drag; }`;
  const verifyLayout = async (dialog, label) => {
    await dialog.waitFor();
    assert.equal((await checkHeader(dialog)).visible, true, `${label}: header must receive hits`);
    const key = await desktop.evaluate(
      ({ BrowserWindow }, css) => BrowserWindow.getAllWindows()[0].webContents.insertCSS(css),
      oldWindowsCss,
    );
    try {
      assert.equal(
        (await checkHeader(dialog)).visible,
        false,
        `${label}: reproduce old Windows overlap`,
      );
    } finally {
      await desktop.evaluate(
        ({ BrowserWindow }, key) =>
          BrowserWindow.getAllWindows()[0].webContents.removeInsertedCSS(key),
        key,
      );
    }
    for (const [width, height] of [
      [1000, 700],
      [1440, 960],
    ]) {
      await desktop.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
        [width, height],
      );
      await page.waitForFunction(
        ({ width, height }) => globalThis.innerWidth === width && globalThis.innerHeight === height,
        { width, height },
      );
      assert.equal(
        (await checkHeader(dialog)).visible,
        true,
        `${label}: resized header must receive hits`,
      );
      const bounds = await dialog.boundingBox();
      assert.ok(
        bounds.y >= 0 && bounds.y + bounds.height <= height + 1,
        `${label}: entire dialog fits`,
      );
    }
    await page.screenshot({ path: join(out, `${label}.png`) });
    layoutChecks.push(label);
  };
  for (const [label, mode] of [
    ['照片', 'photos'],
    ['素材', 'eagle'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const rows = (await (await page.request.get(`${w.origin}/api/${mode}/assets?limit=100`)).json())
      .items;
    const card = page.locator(rows.map((row) => `[data-asset-id="${row.id}"]`).join(',')).first();
    await card.waitFor();
    await card.click({ trial: true });
    assert.equal(await card.getAttribute('draggable'), 'true');
    const id = await card.getAttribute('data-asset-id');
    const original = await page.request.get(`${w.origin}/api/${mode}/assets/${id}/original`);
    assert.equal(original.status(), 200);
    const expectedHash = createHash('sha256')
      .update(await original.body())
      .digest('hex');
    const before = await desktop.evaluate(() => globalThis.testDrags.length);
    await card.dispatchEvent('dragstart');
    for (let n = 0; ; n++) {
      const drags = await desktop.evaluate(() => globalThis.testDrags);
      if (drags.length > before) {
        assert.equal(drags.at(-1)[0].hash, expectedHash);
        break;
      }
      assert.ok(n < 100, 'actual original export must reach the OS drag boundary');
      await new Promise((done) => globalThis.setTimeout(done, 100));
    }
    await card.dispatchEvent('dragend');
    await card.dblclick();
    const viewer = page.getByRole('dialog');
    await verifyLayout(viewer, `${mode}-viewer`);
    await viewer.getByRole('button', { name: '编辑照片', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑照片', exact: true });
    await verifyLayout(editor, `${mode}-editor`);
    await editor.getByRole('button', { name: '关闭编辑器', exact: true }).click();
    const remainingViewer = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: '关闭', exact: true }) });
    if (await remainingViewer.count())
      await remainingViewer.getByRole('button', { name: '关闭', exact: true }).click();
    modes.push(mode);
  }
  const worker = (await readdir('apps/web/dist/assets')).find((name) =>
    /^photo-editor\.worker-.*\.js$/.test(name),
  );
  assert.ok(worker);
  const policy = JSON.parse(
    (await readFile('apps/desktop/src/main/main.ts', 'utf8')).match(
      /"default-src 'self'; script-src[^"\n]+"/,
    )[0],
  );
  const render = () =>
    page.evaluate(
      ({ url, edits }) =>
        new Promise((resolve, reject) => {
          const worker = new globalThis.Worker(url, { type: 'module' });
          const timer = globalThis.setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker response timeout'));
          }, 15000);
          worker.onerror = () => {
            globalThis.clearTimeout(timer);
            worker.terminate();
            reject(new Error('Worker startup failure'));
          };
          worker.onmessage = ({ data }) => {
            globalThis.clearTimeout(timer);
            worker.terminate();
            resolve(data.error ? { error: data.error } : { pixels: Array.from(data.pixels) });
          };
          worker.postMessage({
            id: 1,
            width: 1,
            height: 1,
            pixels: new Uint8Array([37, 81, 149, 255]),
            edits,
          });
        }),
      { url: `${w.origin}/assets/${worker}`, edits: DEFAULT_PHOTO_EDITS },
    );
  assert.deepEqual(await render(), { pixels: [37, 81, 149, 255] });
  await desktop.evaluate(
    ({ session }, oldPolicy) =>
      session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
        callback({
          responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [oldPolicy] },
        }),
      ),
    policy.replace(" 'wasm-unsafe-eval'", ''),
  );
  assert.deepEqual(await render(), { error: 'PHOTO_WASM_BLOCKED' });
  await desktop.evaluate(
    ({ session }, policy) =>
      session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
        callback({
          responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
        }),
      ),
    policy,
  );
  assert.deepEqual(await render(), { pixels: [37, 81, 149, 255] });
  const result = {
    passed: true,
    clientVersion: manifest.version,
    modes,
    layoutChecks,
    oldTitlebarOverlapReproduced: true,
    originalHashesPreserved: true,
    oldCspReproduced: true,
    currentCspPixelsVerified: true,
    limitation:
      'Actual Electron/IPC/HTTP/temporary original files; OS drop intercepted to avoid writing to a user application. Native Windows UI was not available.',
  };
  await writeFile(join(out, 'results.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  const page = desktop?.windows()[0];
  await writeFile(
    join(out, 'failure.json'),
    JSON.stringify(
      {
        error: String(error),
        text: await page?.locator('body').innerText(),
        drags: await desktop?.evaluate(() => globalThis.testDrags),
      },
      null,
      2,
    ),
  );
  await page?.screenshot({ path: join(out, 'failure.png') });
  throw error;
} finally {
  await desktop?.close();
  await rm(profile, { recursive: true, force: true });
}
