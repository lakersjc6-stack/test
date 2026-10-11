import { app, BrowserWindow, Notification, Tray, Menu, nativeImage, shell, powerSaveBlocker, dialog } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createApp } from '../server.mjs';
import { Engine } from '../lib/engine.mjs';
import { allowedRetailerLink } from './links.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
if (process.env.SUMMIT_DESKTOP_DATA_DIR) {
  mkdirSync(join(process.env.SUMMIT_DESKTOP_DATA_DIR, 'session'), { recursive: true });
  app.setPath('userData', process.env.SUMMIT_DESKTOP_DATA_DIR);
  app.setPath('sessionData', join(process.env.SUMMIT_DESKTOP_DATA_DIR, 'session'));
}
let window, tray, server, engine, timer, blocker, quitting = false, ticking = false;
let seen = new Set();
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else {
  app.setAppUserModelId('com.summit.pokemon');
  app.on('second-instance', () => { window?.show(); if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; clearInterval(timer); if (blocker !== undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker); server?.close(); });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Summit could not start', error.message); app.quit(); });
}
function iconImage() {
  // A small original blue/white mark, generated without external assets.
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const at = (y * 32 + x) * 4;
    const mountain = y > 7 && y < 25 && Math.abs(x - 16) < (y - 6) * .6;
    pixels[at] = mountain ? 235 : 69; pixels[at + 1] = mountain ? 245 : 123; pixels[at + 2] = mountain ? 255 : 167; pixels[at + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });
}
async function start() {
  engine = await Engine.open(join(process.env.SUMMIT_DESKTOP_DATA_DIR || app.getPath('userData'), 'workspace.json'));
  seen = new Set(engine.state.notifications.map(n => n.id));
  const sessionToken = randomBytes(32).toString('hex');
  server = createApp(engine, { desktop: true, sessionToken });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const icon = iconImage();
  window = new BrowserWindow({ width: 1400, height: 960, minWidth: 900, minHeight: 650, title: 'Summit · Pokémon drops', icon, backgroundColor: '#f6f8fb', show: false, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const showWindow = () => { window.show(); window.focus(); };
  tray = new Tray(icon); tray.setToolTip('Summit Pokémon · monitors run while the app is open');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Summit', click: showWindow }, { type: 'separator' }, { label: 'Pause all monitors', click: async () => { for (const g of engine.state.groups.filter(g => g.enabled)) engine.stop(g.id); await engine.save(); } }, { label: 'Quit Summit', click: () => app.quit() }]));
  tray.on('double-click', showWindow);
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.once('ready-to-show', showWindow);
  window.webContents.setWindowOpenHandler(({ url }) => { const allowed = allowedRetailerLink(url); if (allowed) shell.openExternal(allowed).catch(error => console.error('Unable to open retailer:', error.message)); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => { details.requestHeaders['X-Summit-Session'] = sessionToken; callback({ requestHeaders: details.requestHeaders }); });
  await window.loadURL(origin);
  Menu.setApplicationMenu(null);
  timer = setInterval(async () => {
    const monitoring = engine.state.groups.some(g => g.enabled);
    if (monitoring && engine.state.settings.keepAwake && (blocker === undefined || !powerSaveBlocker.isStarted(blocker))) blocker = powerSaveBlocker.start('prevent-app-suspension');
    if ((!monitoring || !engine.state.settings.keepAwake) && blocker !== undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    if (ticking) return; ticking = true;
    try {
      await engine.tick();
      for (const n of [...engine.state.notifications].reverse()) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        if (engine.state.settings.desktopNotifications && Notification.isSupported()) {
          const alert = new Notification({ title: n.title, body: n.message, icon, silent: !engine.state.settings.sound });
          alert.on('click', showWindow); alert.show();
        }
      }
    } catch (error) { console.error('Monitor failed:', error.message); } finally { ticking = false; }
  }, 1000);
  // Test-only switch: prove a desktop renderer loaded without exposing Node to it.
  if (process.env.SUMMIT_DESKTOP_SMOKE === '1') {
    try {
      const result = await window.webContents.executeJavaScript(`new Promise(resolve => { const t = setInterval(() => { if (document.querySelector('h1')) { clearInterval(t); resolve({ title: document.title, heading: document.querySelector('h1').textContent, nodeExposed: typeof window.require !== 'undefined' }); } }, 100); })`);
      console.log('DESKTOP_SMOKE', JSON.stringify(result));
      if (result.nodeExposed) process.exitCode = 1;
    } catch (error) { console.error(error); process.exitCode = 1; }
    app.quit();
  }
}
