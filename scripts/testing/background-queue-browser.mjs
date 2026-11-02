import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

// Only a live synthetic --serve workbench is accepted. No production credentials or endpoints.
const require = createRequire(import.meta.url);
const runtime =
  process.env.SEKEREAGLE_PLAYWRIGHT_MODULE ??
  join(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
  );
const { chromium, _electron } = require(runtime);
const { Client } = require('pg');
const root = process.cwd();
const out = resolve('.omx/artifacts/background-queue-browser');
await mkdir(out, { recursive: true });
const w = JSON.parse(
  await readFile(resolve('.omx/artifacts/background-queue-workbench.json'), 'utf8'),
);
const origin = new URL(w.origin);
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname));
assert.equal(w.basic, true);
assert.match(w.ownerId, /^[0-9a-f-]{36}$/);
assert.equal(w.loginUrl, `${w.origin}/__test/login`);
process.kill(w.pid, 0);
const dbContainer = w.containers.find((name) =>
  /^sekereagle-photo-workbench-[a-f0-9]{8}-db$/.test(name),
);
assert.ok(dbContainer, 'a disposable synthetic database is required');
const pgPort = execFileSync('docker', ['port', dbContainer, '5432'], { encoding: 'utf8' })
  .trim()
  .split(':')
  .at(-1);
assert.match(pgPort, /^\d+$/);
const databaseUrl = `postgresql://sekereagle_test@127.0.0.1:${pgPort}/sekereagle_test`;
assertSafeRuntimeTarget({
  databaseUrl,
  s3Endpoint: 'http://127.0.0.1:9000',
  s3Bucket: 'sekereagle-assets',
});
const lock = new Client({ connectionString: databaseUrl });
await lock.connect();
let locked = false;
async function acquire(mode) {
  assert.equal(locked, false);
  await lock.query('BEGIN');
  await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [
    `sekereagle:privacy:${w.ownerId}:${mode}`,
  ]);
  locked = true;
}
async function release() {
  if (locked) await lock.query('ROLLBACK');
  locked = false;
}
async function waitFor(read, accepts, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await delay(250);
  }
  throw new Error(`Timed out: ${label}`);
}
async function json(page, method, path, data) {
  const response = await page.request.fetch(`${w.origin}/api/${path}`, {
    method,
    data,
    headers: { origin: w.origin },
  });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function originalHash(page, mode, id) {
  const response = await page.request.get(`${w.origin}/api/${mode}/assets/${id}/original`);
  assert.equal(response.status(), 200);
  return createHash('sha256')
    .update(await response.body())
    .digest('hex');
}
async function settled(page, mode, ids) {
  return waitFor(
    () => json(page, 'GET', `${mode}/operations`),
    (rows) =>
      ids.every((id) => {
        const operation = rows.find((row) => row.id === id);
        return operation && !operation.queued && !operation.running && operation.failed === 0;
      }),
    'published queued operations',
    90000,
  );
}
async function select(page, ids) {
  await page.keyboard.press('Escape');
  for (let index = 0; index < ids.length; index++) {
    const card = page.locator(`[data-asset-id="${ids[index]}"]`);
    await card.waitFor();
    await card.click(index === 0 ? {} : { modifiers: ['Meta'] });
  }
  for (const id of ids)
    assert.equal(
      await page.locator(`[data-asset-id="${id}"]`).getAttribute('aria-pressed'),
      'true',
    );
}
async function submitResponse(page, path, trigger) {
  const next = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/${path}` &&
      ['POST', 'PATCH', 'PUT'].includes(response.request().method()),
    { timeout: 15000 },
  );
  const started = performance.now();
  await trigger();
  const response = await next;
  assert.equal(response.status(), 202, `${path} must return a durable receipt`);
  return { receipt: await response.json(), acceptedMs: Math.round(performance.now() - started) };
}
async function verify(page, client) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(w.loginUrl);
  await page.getByRole('button', { name: '照片', exact: true }).waitFor({ timeout: 30000 });
  const modes = [];
  for (const [mode, label, dbMode] of [
    ['photos', '照片', 'PHOTO'],
    ['eagle', '素材', 'MATERIAL'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    let assets = (await json(page, 'GET', `${mode}/assets?limit=100`)).items.filter(
      (asset) => asset.lifecycleStatus === 'READY' && asset.mimeType.startsWith('image/'),
    );
    if (assets.length < 2) {
      assert.ok(assets.length, `${mode} synthetic image fixture missing`);
      const original = await page.request.get(
        `${w.origin}/api/${mode}/assets/${assets[0].id}/original`,
      );
      await page.getByLabel('选择导入文件', { exact: true }).setInputFiles({
        name: `queue-${client}-${mode}.png`,
        mimeType: 'image/png',
        buffer: await original.body(),
      });
      assets = await waitFor(
        async () =>
          (await json(page, 'GET', `${mode}/assets?limit=100`)).items.filter(
            (asset) => asset.lifecycleStatus === 'READY' && asset.mimeType.startsWith('image/'),
          ),
        (rows) => rows.length >= 2,
        'second managed fixture',
      );
    }
    const tag = await json(page, 'POST', `${mode}/manual-tags`, {
      name: `queue-${client}-${mode}-${Date.now()}`,
    });
    // Refresh the catalog once before measurement, then exercise real visible controls.
    await page.reload();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator('[data-asset-id]').first().waitFor();
    const visibleIds = await page
      .locator('[data-asset-id]')
      .evaluateAll((elements) => elements.map((element) => element.dataset.assetId));
    assets = visibleIds.map((id) => assets.find((asset) => asset.id === id)).filter(Boolean);
    assert.ok(assets.length >= 2, `${mode} needs two independently visible cards`);
    const ids = assets.slice(0, 2).map((asset) => asset.id);
    const hashes = await Promise.all(ids.map((id) => originalHash(page, mode, id)));
    await select(page, ids);
    await page.locator(`[data-asset-id="${ids[1]}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '添加标签', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加标签', exact: true });
    await dialog.getByRole('checkbox', { name: tag.name, exact: true }).check();
    await acquire(dbMode);
    const tagSubmit = await submitResponse(page, `${mode}/assets/batch/manual-tags`, () =>
      dialog.getByRole('button', { name: '添加 1 个标签到 2 项素材', exact: true }).click(),
    );
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    const waiting = (await json(page, 'GET', `${mode}/operations`)).find(
      (row) => row.id === tagSubmit.receipt.id,
    );
    assert.ok(
      waiting && waiting.completed === 0 && waiting.queued + waiting.running > 0,
      'real held privacy lock delays publication, never acceptance',
    );
    assert.ok(
      await page
        .getByRole('status')
        .filter({ hasText: /标签|处理/ })
        .count(),
      'queued receipt is visible',
    );
    // Selection, a second write and metadata editing remain usable while publication is locked.
    await select(page, [ids[0]]);
    const showDetails = page.getByRole('button', {
      name: mode === 'photos' ? '显示照片详情' : '显示素材详情',
      exact: true,
    });
    if (await showDetails.count()) await showDetails.click();
    const ratingValue = assets[0].rating === 5 ? 4 : 5;
    const rating = await submitResponse(page, `${mode}/assets/${ids[0]}`, () =>
      page.getByRole('button', { name: `${ratingValue} 星`, exact: true }).click(),
    );
    const description = `queued-${client}-${mode}-${Date.now()}`;
    const metadata = await submitResponse(page, `${mode}/assets/${ids[0]}`, async () => {
      await page.getByRole('textbox', { name: '素材描述', exact: true }).fill(description);
      await page.getByRole('textbox', { name: '素材描述', exact: true }).blur();
    });
    await page.screenshot({ path: join(out, `${client}-${mode}-held.png`) });
    await release();
    await settled(page, mode, [tagSubmit.receipt.id, rating.receipt.id, metadata.receipt.id]);
    const detail = await json(page, 'GET', `${mode}/assets/${ids[0]}`);
    assert.equal(detail.rating, ratingValue);
    assert.equal(detail.annotation?.description, description);
    for (const id of ids) {
      const row = await json(page, 'GET', `${mode}/assets/${id}`);
      assert.ok(row.manualTags.some((entry) => entry.id === tag.id));
    }
    assert.deepEqual(await Promise.all(ids.map((id) => originalHash(page, mode, id))), hashes);
    // Obtain the copy/paste recipe through the actual editor; no synthetic React state injection.
    await select(page, [ids[0]]);
    await page.locator(`[data-asset-id="${ids[0]}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '编辑照片', exact: true }).click();
    await page.getByRole('button', { name: '复制编辑参数', exact: true }).click({ timeout: 30000 });
    await page.getByRole('button', { name: '关闭编辑器', exact: true }).click();
    const closeDraft = page.getByRole('button', { name: '保留草稿并关闭', exact: true });
    if (await closeDraft.count()) await closeDraft.click();
    await select(page, ids);
    await page.getByRole('button', { name: '套用编辑参数', exact: true }).click();
    const batch = page.getByRole('dialog', { name: '批量套用编辑参数', exact: true });
    await acquire(dbMode);
    const edit = await submitResponse(page, `${mode}/assets/batch/edit-renders`, () =>
      batch.getByRole('button', { name: '开始套用', exact: true }).click(),
    );
    await batch.waitFor({ state: 'hidden', timeout: 10000 });
    await select(page, [ids[1]]);
    const editWaiting = (await json(page, 'GET', `${mode}/operations`)).find(
      (row) => row.id === edit.receipt.id,
    );
    assert.ok(
      editWaiting && editWaiting.completed === 0 && editWaiting.queued + editWaiting.running > 0,
    );
    await release();
    await settled(page, mode, [edit.receipt.id]);
    assert.deepEqual(await Promise.all(ids.map((id) => originalHash(page, mode, id))), hashes);
    modes.push({
      mode: dbMode,
      selected: ids.length,
      tagAcceptedMs: tagSubmit.acceptedMs,
      ratingAcceptedMs: rating.acceptedMs,
      descriptionAcceptedMs: metadata.acceptedMs,
      batchEditAcceptedMs: edit.acceptedMs,
      acceptedWhilePrivacyLocked: true,
      workspaceSelectableWhileWaiting: true,
      originalHashesPreserved: true,
      tagsAndSequentialMetadataPublished: true,
    });
  }
  assert.deepEqual(pageErrors, []);
  const result = { client, passed: true, modes, pageErrors };
  await writeFile(join(out, `${client}.json`), JSON.stringify(result, null, 2));
  return result;
}
let browser, desktop;
const profile = join(out, 'electron-profile');
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const web = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const results =
    process.env.BACKGROUND_QUEUE_ELECTRON_ONLY === '1'
      ? [JSON.parse(await readFile(join(out, 'chrome.json'), 'utf8'))]
      : [await verify(web, 'chrome')];
  for (const directory of ['home', 'appData', 'userData', 'temp'])
    await mkdir(join(profile, directory), { recursive: true });
  const entry = join(out, 'electron-main.cjs');
  await writeFile(
    entry,
    `const {app}=require('electron');for(const key of ['home','appData','userData','temp']) app.setPath(key,require('node:path').join(${JSON.stringify(profile)},key));require(${JSON.stringify(join(root, 'apps/desktop/dist/main.cjs'))});`,
  );
  const env = { ...process.env, SEKEREAGLE_SERVER_URL: w.origin };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({
    executablePath: require('electron'),
    args: [entry],
    env,
    timeout: 30000,
  });
  const electronPage = await desktop.firstWindow();
  await electronPage.setViewportSize({ width: 1440, height: 1000 });
  results.push(await verify(electronPage, 'electron'));
  await writeFile(join(out, 'results.json'), JSON.stringify({ passed: true, results }, null, 2));
  process.stdout.write(
    JSON.stringify({
      passed: true,
      clients: results.map((result) => result.client),
      modesPerClient: 2,
    }) + '\n',
  );
} catch (error) {
  for (const page of [
    ...(browser?.contexts().flatMap((context) => context.pages()) ?? []),
    ...(desktop?.windows() ?? []),
  ]) {
    await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
    await writeFile(join(out, 'failure.html'), await page.content()).catch(() => {});
  }
  await writeFile(join(out, 'failure.json'), JSON.stringify({ error: error.message }, null, 2));
  throw error;
} finally {
  await release();
  await lock.end();
  await desktop?.close();
  await browser?.close();
  await rm(profile, { recursive: true, force: true });
}
