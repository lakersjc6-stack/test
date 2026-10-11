import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { Engine, stores } from './lib/engine.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
export function createApp(engine) {
  const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
    try {
      // Local-only service. Reject cross-origin mutations and DNS-rebinding hostnames.
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(res, 403, { error: 'Local access only' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(res, 403, { error: 'Cross-origin access denied' });
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/state') return send(res, 200, { ...engine.state, stores });
      if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, version: '0.1.0' });
      if (req.method === 'POST' && pathname.startsWith('/api/')) {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Use application/json' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 100_000) return send(res, 413, { error: 'Request too large' }); }
        const body = JSON.parse(raw || '{}'); let result = { ok: true };
        switch (pathname) {
          case '/api/groups': if (engine.state.groups.length >= 30) throw new Error('Maximum 30 groups'); result = engine.addGroup(body); break;
          case '/api/groups/delete': engine.deleteGroup(body.id); break;
          case '/api/tasks': result = engine.addTasks(body.groupId, body.profileIds); break;
          case '/api/tasks/delete': engine.state.tasks = engine.state.tasks.filter(t => !body.ids?.includes(t.id)); break;
          case '/api/start': engine.start(body.id); break;
          case '/api/stop': engine.stop(body.id); break;
          case '/api/demo-stock': { const group = engine.group(body.id); if (group.store !== 'demo') throw new Error('Demo controls only apply to demo stores'); group.demoStock = !group.demoStock; engine.lastPoll.delete(group.id); break; }
          case '/api/profiles': result = engine.addProfile(body); break;
          case '/api/profiles/delete': if (engine.state.tasks.some(t => t.profileId === body.id)) throw new Error('Remove this profile’s tasks before deleting it'); engine.state.profiles = engine.state.profiles.filter(p => p.id !== body.id); break;
          case '/api/settings': if (typeof body.notifications === 'boolean') engine.state.settings.notifications = body.notifications; if (typeof body.sound === 'boolean') engine.state.settings.sound = body.sound; break;
          case '/api/notifications/read': for (const n of engine.state.notifications) n.read = true; break;
          default: return send(res, 404, { error: 'Unknown endpoint' });
        }
        await engine.save(); return send(res, 200, result);
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      const asset = assets[pathname]; if (!asset) return send(res, 404, { error: 'Not found' });
      const data = await readFile(join(root, 'public', asset[0])); res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-cache' }); res.end(data);
    } catch (error) { send(res, 400, { error: error instanceof SyntaxError ? 'Invalid JSON' : error.message }); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const engine = await Engine.open(process.env.SUMMIT_DATA_FILE || join(root, '.local', 'workspace.json'));
  const server = createApp(engine);
  const port = Number(process.env.PORT || 3000);
  let ticking = false;
  const timer = setInterval(async () => { if (ticking) return; ticking = true; try { await engine.tick(); } catch (error) { console.error('Monitor persistence failed:', error.message); } finally { ticking = false; } }, 1000);
  server.listen(port, '127.0.0.1', () => console.log(`Summit running on port ${port}; demo monitoring available. Live checkouts are not automated.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); server.close(async () => { await engine.save(); process.exit(0); }); });
}
