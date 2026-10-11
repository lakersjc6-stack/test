import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Engine, initialState, productHandle, validateGroup, normalizeProduct } from '../lib/engine.mjs';
import { createApp } from '../server.mjs';

function workspace(options) {
  const engine = new Engine(initialState(), options);
  engine.state.profiles[0].size = '9'; engine.state.profiles[1].size = '10';
  const group = engine.state.groups[0];
  engine.addTasks(group.id, engine.state.profiles.slice(0, 2).map(p => p.id));
  return { engine, group };
}
test('product URLs are restricted to the selected store and validated before requests', () => {
  assert.equal(productHandle('https://kith.com/products/runner?variant=12', 'kith'), 'runner');
  for (const url of ['http://kith.com/products/a', 'https://127.0.0.1/products/a', 'https://kith.com.evil.test/products/a', 'https://user@kith.com/products/a', 'https://kith.com:9000/products/a', 'https://kith.com/admin', '../admin']) assert.throws(() => productHandle(url, 'kith'));
  assert.throws(() => validateGroup({ name: 'Invalid', store: 'demo', products: ['a'], interval: 1 }));
});
test('profile-group task creation deduplicates and requires existing profiles', () => {
  const { engine, group } = workspace();
  assert.equal(engine.state.tasks.length, 2);
  assert.equal(engine.addTasks(group.id, [engine.state.profiles[0].id]).length, 0);
  assert.throws(() => engine.addTasks(group.id, ['missing']));
});
test('shared multi-product monitor detects size matches and only notifies on stock transitions', async () => {
  let calls = 0;
  const { engine, group } = workspace({ loader: async (g, handle) => { calls++; return { handle, title: handle, variants: [{ id: '123', title: '9', options: ['9'], available: g.demoStock, price: 140 }] }; } });
  engine.start(group.id); await engine.tick();
  assert.equal(calls, 2); // two products, not two products per profile
  assert.equal(engine.state.tasks[0].status, 'monitoring');
  group.demoStock = true; await engine.pollGroup(group);
  assert.equal(engine.state.tasks[0].status, 'available');
  assert.equal(engine.state.tasks[1].status, 'monitoring'); // size 10 not available
  assert.equal(engine.state.notifications.length, 1);
  assert.equal(engine.state.tasks[0].matches[0].url, null);
  await engine.pollGroup(group); assert.equal(engine.state.notifications.length, 1);
  group.demoStock = false; await engine.pollGroup(group); assert.equal(engine.state.tasks[0].matches.length, 0);
  group.demoStock = true; await engine.pollGroup(group); assert.equal(engine.state.notifications.length, 2);
});
test('scheduler waits until due and honors group polling interval', async () => {
  let now = 1_000_000, calls = 0;
  const { engine, group } = workspace({ clock: () => now, loader: async (g, h) => { calls++; return { handle: h, title: h, variants: [] }; } });
  group.scheduledAt = new Date(now + 5000).toISOString(); engine.start(group.id);
  await engine.tick(); assert.equal(calls, 0); assert.equal(engine.state.tasks[0].status, 'scheduled');
  now += 5000; await engine.tick(); assert.equal(calls, 2);
  now += 2000; await engine.tick(); assert.equal(calls, 2);
  now += 28000; await engine.tick(); assert.equal(calls, 4);
});
test('pausing during an in-flight check prevents stale updates', async () => {
  let resolve;
  const { engine, group } = workspace({ loader: () => new Promise(r => { resolve = r; }) });
  engine.start(group.id); const polling = engine.pollGroup(group);
  engine.stop(group.id);
  resolve({ handle: 'a', title: 'a', variants: [{ id: '12', title: '9', options: ['9'], available: true }] });
  await polling;
  assert.equal(engine.state.tasks[0].status, 'paused'); assert.equal(engine.state.notifications.length, 0);
});
test('store errors clear old matches and appear in task state, then can recover', async () => {
  let failing = false;
  const { engine, group } = workspace({ loader: async (g, h) => { if (failing) throw new Error('HTTP 403'); return { handle: h, title: h, variants: [{ id: '12', title: '9', options: ['9'], available: true, price: 100 }] }; } });
  group.store = 'kith'; engine.start(group.id); await engine.pollGroup(group);
  assert.equal(engine.state.tasks[0].matches[0].url, 'https://kith.com/cart/12:1');
  failing = true; await engine.pollGroup(group);
  assert.equal(engine.state.tasks[0].status, 'error'); assert.equal(engine.state.tasks[0].matches.length, 0);
  assert.equal(engine.state.tasks[0].message, 'HTTP 403');
  failing = false; await engine.pollGroup(group); assert.equal(engine.state.tasks[0].status, 'available');
});
test('normalization rejects malformed products and preserves exact size options', () => {
  assert.throws(() => normalizeProduct({}, 'runner'));
  const result = normalizeProduct({ title: 'Runner', variants: [{ id: 123, title: 'Blue / 9', option1: 'Blue', option2: '9', available: true, price: 14000 }, { id: 'evil', available: true }] }, 'runner');
  assert.equal(result.variants.length, 1); assert.equal(result.variants[0].price, 140); assert.deepEqual(result.variants[0].options, ['Blue', '9']);
});
test('workspace survives disk reload and running monitors pause on restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'summit-test-'));
  try {
    const file = join(dir, 'workspace.json'); const engine = await Engine.open(file);
    const group = engine.state.groups[0]; engine.addTasks(group.id, [engine.state.profiles[0].id]); engine.start(group.id); await engine.save();
    const restored = await Engine.open(file);
    assert.equal(restored.state.tasks.length, 1); assert.equal(restored.state.groups[0].enabled, false); assert.equal(restored.state.tasks[0].status, 'paused');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('HTTP API exercises group creation, task creation, start/stop and local access restrictions', async () => {
  const engine = new Engine(initialState()); const server = createApp(engine);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(`${url}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const groupResponse = await post('groups', { name: 'Test release', store: 'demo', products: ['runner'], sizes: ['9'], interval: 30 });
    assert.equal(groupResponse.status, 200); const group = await groupResponse.json();
    assert.equal((await post('tasks', { groupId: group.id, profileIds: [engine.state.profiles[0].id] })).status, 200);
    assert.equal((await post('start', { id: group.id })).status, 200);
    await engine.tick();
    const data = await (await fetch(`${url}/api/state`)).json(); assert.equal(data.tasks[0].status, 'monitoring');
    assert.equal((await post('stop', { id: group.id })).status, 200); assert.equal(engine.state.tasks[0].status, 'paused');
    assert.equal((await post('start', { id: group.id }, { origin: 'https://evil.test' })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => { const req = request(`${url}/api/state`, { headers: { host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(`${url}/../server.mjs`)).status, 404);
    assert.equal((await post('groups', { name: 'Bad', store: 'demo', products: ['runner'], interval: 1 })).status, 400);
    assert.equal((await fetch(url)).status, 200);
  } finally { await new Promise(r => server.close(r)); }
});
