import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, initialState, stores, validateGroup } from '../lib/engine.mjs';
import { parseRetailerProduct, retailerProductUrl } from '../lib/retailers.mjs';
import { allowedRetailerLink } from '../desktop/links.mjs';
import { createApp } from '../server.mjs';

const target = 'https://www.target.com/p/pokemon-elite-trainer-box/-/A-12345678';
const html = (availability, extra = {}) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Pokémon TCG Elite Trainer Box', url: target, offers: { '@type': 'Offer', availability: `https://schema.org/${availability}`, price: 49.99, priceCurrency: 'USD', ...extra } })}</script>`;
test('Pokémon URLs are store-specific product links, without tracking parameters', () => {
  assert.equal(retailerProductUrl(target + '?ref=tracking', stores.find(s => s.id === 'target')), target);
  assert.equal(retailerProductUrl('https://pokemoncenter.com/product/290-12345/pokemon-box', stores.find(s => s.id === 'pokemon-center')), 'https://www.pokemoncenter.com/product/290-12345/pokemon-box');
  assert.throws(() => retailerProductUrl('https://www.target.com/s?searchTerm=pokemon', stores.find(s => s.id === 'target')));
  assert.throws(() => retailerProductUrl('https://www.walmart.com/ip/1234', stores.find(s => s.id === 'target')));
  assert.throws(() => validateGroup({ name: 'Box', store: 'target', products: [target], maxPrice: -1 }));
});
test('stock parser distinguishes explicit in-stock, preorder, sold-out, and unknown', () => {
  assert.equal(parseRetailerProduct(html('InStock'), target).variants[0].available, true);
  assert.equal(parseRetailerProduct(html('PreOrder'), target).variants[0].offerStatus, 'PreOrder');
  assert.equal(parseRetailerProduct(html('OutOfStock'), target).variants[0].available, false);
  assert.throws(() => parseRetailerProduct('<h1>Add to cart</h1>', target), /unambiguous/);
  assert.throws(() => parseRetailerProduct(html('InStock') + '<h1>Verify you are human</h1>', target), /verification/);
  assert.throws(() => parseRetailerProduct('<h1>Request unsuccessful. Incapsula incident ID: demo</h1>', target), /verification/);
  assert.throws(() => parseRetailerProduct(html('InStock').replace('Pokémon TCG Elite Trainer Box', 'Running shoes'), target), /Pokémon products only/);
  assert.throws(() => parseRetailerProduct(html('InStock').replace(target, 'https://www.target.com/p/other/-/A-99999999'), target), /unambiguous/);
});
test('price ceiling rejects inflated and unknown prices, without auto-ordering', async () => {
  let price = 99.99;
  const engine = new Engine(initialState(), { loader: async () => parseRetailerProduct(html('InStock', { price }), target) });
  const group = engine.addGroup({ name: 'ETB', store: 'target', products: [target], maxPrice: 60 });
  engine.addTasks(group.id, [engine.state.profiles[0].id]); engine.start(group.id);
  await engine.pollGroup(group); const task = engine.state.tasks[0]; assert.equal(task.matches.length, 0);
  price = undefined; await engine.pollGroup(group); assert.equal(task.matches.length, 0);
  price = 49.99; await engine.pollGroup(group); assert.equal(task.matches[0].url, target); assert.equal(task.status, 'available');
});
test('one unreadable product does not hide another product’s stock', async () => {
  const engine = new Engine(initialState(), { loader: async (g, url) => { if (url.includes('99999999')) throw new Error('HTTP 403'); return parseRetailerProduct(html('InStock'), target); } });
  const group = engine.addGroup({ name: 'Two products', store: 'target', products: [target, 'https://www.target.com/p/blocked/-/A-99999999'] });
  engine.addTasks(group.id, [engine.state.profiles[0].id]); engine.start(group.id); await engine.pollGroup(group);
  assert.equal(engine.state.tasks[0].status, 'available'); assert.equal(engine.state.tasks[0].matches.length, 1);
  assert.equal(group.health[1].status, 'unknown'); assert.equal(group.retrySeconds, 60);
});
test('failed reads back off, and readable recovery restores normal polling', async () => {
  let now = 1000000, failing = true, calls = 0;
  const engine = new Engine(initialState(), { clock: () => now, loader: async () => { calls++; if (failing) throw new Error('HTTP 429'); return parseRetailerProduct(html('OutOfStock'), target); } });
  const group = engine.addGroup({ name: 'Retry', store: 'target', products: [target] }); engine.addTasks(group.id, [engine.state.profiles[0].id]); engine.start(group.id);
  await engine.tick(); assert.equal(group.retrySeconds, 60);
  now += 30000; await engine.tick(); assert.equal(calls, 1);
  now += 30000; await engine.tick(); assert.equal(calls, 2); assert.equal(group.retrySeconds, 120);
  failing = false; now += 120000; await engine.tick(); assert.equal(group.retrySeconds, 30); assert.equal(engine.state.tasks[0].status, 'monitoring');
});
test('release planner reminds once and prepares one scheduled monitor group', async () => {
  let now = 1000000;
  const engine = new Engine(initialState(), { clock: () => now });
  const release = engine.addRelease({ name: 'Pokémon box', store: 'target', url: target, releaseAt: new Date(now + 1200000).toISOString(), leadMinutes: 10 });
  const group = engine.prepareRelease(release.id); assert.equal(engine.prepareRelease(release.id).id, group.id); assert.equal(group.enabled, false);
  assert.equal(Date.parse(group.scheduledAt), now + 600000);
  await engine.tick(); assert.equal(engine.state.notifications.length, 0);
  now += 600000; await engine.tick(); assert.equal(engine.state.notifications.length, 1);
  await engine.tick(); assert.equal(engine.state.notifications.length, 1);
});
test('desktop retailer links cannot open arbitrary files, apps, or hosts', () => {
  assert.equal(allowedRetailerLink(target), target);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://evil.test', 'https://www.target.com.evil.test', 'https://user@www.target.com/p/a', 'http://www.target.com']) assert.equal(allowedRetailerLink(url), null);
});
test('a slow retailer does not block another group’s stock alert', async () => {
  let releaseSlow;
  const engine = new Engine(initialState(), { loader: async (_group, url) => {
    if (url.includes('99999999')) await new Promise(resolve => { releaseSlow = resolve; });
    return parseRetailerProduct(html('InStock'), target);
  } });
  const slow = engine.addGroup({ name: 'Slow', store: 'target', products: ['https://www.target.com/p/slow/-/A-99999999'] });
  const fast = engine.addGroup({ name: 'Fast', store: 'target', products: [target] });
  for (const group of [slow, fast]) { engine.addTasks(group.id, [engine.state.profiles[0].id]); engine.start(group.id); }
  const ticking = engine.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.state.tasks.find(t => t.groupId === fast.id).status, 'available');
  releaseSlow(); await ticking;
});
test('desktop server requires its private per-process session token', async () => {
  const server = createApp(new Engine(initialState()), { desktop: true, sessionToken: 'test-token' });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(url + '/api/state')).status, 403);
    const response = await fetch(url + '/api/state', { headers: { 'x-summit-session': 'test-token' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).desktop, true);
  } finally { await new Promise(r => server.close(r)); }
});
