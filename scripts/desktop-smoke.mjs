import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronExecutable from 'electron';
import { fileURLToPath } from 'node:url';
process.on('uncaughtExceptionMonitor', error => {
  if (process.env.GITHUB_ACTIONS) console.error('::error title=Desktop smoke failure::' + String(error.stack || error).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
});
// Normalize the directory: a trailing Windows backslash can interfere with
// the Electron launcher's quoted command-line arguments.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const testDirectory = await mkdtemp(join(tmpdir(), 'summit-desktop-smoke-'));
const environment = { ...process.env, SUMMIT_DESKTOP_DATA_DIR: testDirectory };
if (process.platform === 'linux') { environment.XDG_CONFIG_HOME = join(testDirectory, 'config'); environment.XDG_CACHE_HOME = join(testDirectory, 'cache'); }
const desktop = await electron.launch({ executablePath: electronExecutable, args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), root], env: environment, timeout: 60000 });
const page = await desktop.firstWindow();
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('dialog', dialog => dialog.accept());
try {
  await page.getByRole('heading', { name: 'Your next Pokémon drop.', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/state')).json()).desktop), true);
  await page.locator('.sidebar [data-page=tasks]').click();
  await page.getByRole('button', { name: 'Add tasks', exact: false }).click();
  await page.getByRole('button', { name: 'Select Pokémon', exact: true }).click();
  await page.getByRole('button', { name: 'Create tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Start group', exact: false }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody .status.monitoring').length === 2);
  await page.getByRole('button', { name: 'Monitor list', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate restock', exact: true }).click();
  await page.getByRole('button', { name: /^Tasks / }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody .status.available').length === 2);
  await page.getByRole('button', { name: 'View task details', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Pokémon TCG · Demo Elite Trainer Box' }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Pause group', exact: false }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody .status.paused').length === 2);
  await page.locator('.sidebar [data-page=releases]').click();
  await page.getByRole('button', { name: 'Plan release', exact: false }).first().click();
  await page.locator('[name=name]').fill('Pokémon test release');
  await page.locator('[name=store]').selectOption('target');
  await page.locator('[name=url]').fill('https://www.target.com/p/pokemon-etb/-/A-12345678');
  await page.locator('[name=releaseAt]').fill('2099-01-01T09:00');
  await page.getByRole('button', { name: 'Save release', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare monitor', exact: true }).click();
  await page.getByRole('heading', { name: 'Drop groups', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start group', exact: false }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody .status.scheduled').length === 1);
  await page.getByRole('button', { name: 'Pause group', exact: false }).click();
  await page.waitForFunction(() => document.querySelectorAll('tbody .status.paused').length === 1);
  await page.locator('.sidebar [data-page=settings]').click();
  await page.getByLabel('Windows desktop notifications', { exact: false }).uncheck();
  await page.waitForFunction(async () => (await (await fetch('/api/state')).json()).settings.desktopNotifications === false);
  await page.locator('.sidebar [data-page=retailers]').click();
  assert.equal(await page.locator('.retailer-card').count(), 3);
  await page.locator('.sidebar [data-page=overview]').click();
  await page.getByRole('heading', { name: 'Your next Pokémon drop.', exact: true }).waitFor();
  await mkdir(join(root, '.local'), { recursive: true });
  await page.screenshot({ path: join(root, '.local', 'pokemon-desktop.png'), fullPage: true });
  const bounds = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(bounds.width >= 900);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false, 'Close should hide to tray');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  assert.deepEqual(errors, []);
  console.log('PASS: real Electron desktop startup, isolated renderer, private session, Pokémon restock, release planning, scheduled monitor, settings, retailer cards, close-to-tray.');
} finally { await desktop.close(); await rm(testDirectory, { recursive: true, force: true }); }
