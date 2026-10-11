import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pokemonRetailers, retailerProductUrl, parseRetailerProduct, readBoundedResponse } from './retailers.mjs';

export const stores = [
  { id: 'demo', name: 'Pokémon Demo', domain: null, verified: true, kind: 'demo' },
  ...pokemonRetailers,
  { id: 'kith', name: 'Kith (legacy)', domain: 'kith.com', verified: false, legacy: true },
  { id: 'bodega', name: 'Bodega (legacy)', domain: 'bdgastore.com', verified: false, legacy: true },
  { id: 'undefeated', name: 'Undefeated (legacy)', domain: 'undefeated.com', verified: false, legacy: true },
];
const id = () => randomUUID();
export function initialState() {
  const profiles = [
    { id: id(), name: 'Personal', group: 'Pokémon', email: '', size: 'Any', address: '' },
    { id: id(), name: 'Sealed collection', group: 'Pokémon', email: '', size: 'Any', address: '' },
    { id: id(), name: 'Collectibles', group: 'Collectibles', email: '', size: 'Any', address: '' },
  ];
  return {
    version: 1, profiles,
    groups: [{ id: id(), name: 'Pokémon TCG demo', store: 'demo', products: ['demo-elite-trainer-box', 'demo-booster-bundle'], interval: 30, sizes: ['Any'], quantity: 1, maxPrice: null, scheduledAt: '', enabled: false, demoStock: false }],
    tasks: [], logs: [], notifications: [], releases: [],
    settings: { notifications: true, desktopNotifications: true, keepAwake: true, sound: true },
  };
}
export function productHandle(input, storeId) {
  const store = stores.find(s => s.id === storeId);
  if (!store) throw new Error('Unknown store');
  const text = String(input).trim();
  if (store.kind === 'product-page') return retailerProductUrl(text, store);
  let handle = text;
  if (text.includes('://')) {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !store.domain || ![store.domain, `www.${store.domain}`].includes(url.hostname)) throw new Error('Use an HTTPS product URL from the selected store');
    const match = url.pathname.match(/^\/products\/([a-zA-Z0-9_-]+)\/?$/);
    if (!match) throw new Error('Use a product URL ending in /products/product-handle');
    handle = match[1];
  }
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(handle)) throw new Error('Invalid product handle');
  return handle;
}
export function validateGroup(value) {
  const name = String(value.name || '').trim();
  if (!name || name.length > 80) throw new Error('Group name is required (80 characters maximum)');
  if (!Array.isArray(value.products) || !value.products.length || value.products.length > 10) throw new Error('Add between 1 and 10 products');
  const products = [...new Set(value.products.map(p => productHandle(p, value.store)))];
  const interval = Number(value.interval ?? 30);
  if (!Number.isInteger(interval) || interval < 30 || interval > 3600) throw new Error('Monitor delay must be 30–3600 seconds');
  const quantity = Number(value.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) throw new Error('Quantity must be 1–5');
  const scheduledAt = value.scheduledAt || '';
  if (scheduledAt && !Number.isFinite(Date.parse(scheduledAt))) throw new Error('Invalid scheduled time');
  const sizes = Array.isArray(value.sizes) ? value.sizes.map(String).map(s => s.trim()).filter(Boolean) : ['Any'];
  if (!sizes.length || sizes.length > 30 || sizes.some(s => s.length > 40)) throw new Error('Select valid sizes');
  const maxPrice = value.maxPrice === undefined || value.maxPrice === null || value.maxPrice === '' ? null : Number(value.maxPrice);
  if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > 10000)) throw new Error('Price ceiling must be between $0 and $10,000');
  return { name, store: value.store, products, interval, quantity, sizes, maxPrice, scheduledAt, enabled: false, demoStock: false };
}
export function normalizeProduct(data, handle) {
  if (!data || typeof data.title !== 'string' || !Array.isArray(data.variants)) throw new Error('Store returned an unsupported product response');
  return {
    handle, title: data.title,
    variants: data.variants.filter(v => /^\d+$/.test(String(v.id))).map(v => ({ id: String(v.id), title: String(v.public_title || v.title || 'Default'), options: [v.option1, v.option2, v.option3].filter(Boolean).map(String), available: v.available === true, price: Number(v.price) / 100 })),
  };
}
export async function fetchProduct(group, handle) {
  if (group.store === 'demo') return { handle, title: handle.includes('booster') ? 'Pokémon TCG · Demo Booster Bundle' : 'Pokémon TCG · Demo Elite Trainer Box', variants: [{ id: '1000', title: 'Any', options: ['Any'], price: handle.includes('booster') ? 26.94 : 49.99, currency: 'USD', available: group.demoStock }] };
  const store = stores.find(s => s.id === group.store);
  const url = store.kind === 'product-page' ? productHandle(handle, group.store) : `https://${store.domain}/products/${productHandle(handle, group.store)}.js`;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { accept: store.kind === 'product-page' ? 'text/html' : 'application/json', 'user-agent': 'SummitPokemonMonitor/0.2' } });
  if (!response.ok) throw new Error(`Store returned HTTP ${response.status}. Stock is unknown.`);
  const text = await readBoundedResponse(response);
  return store.kind === 'product-page' ? parseRetailerProduct(text, url) : normalizeProduct(JSON.parse(text), handle);
}

export class Engine {
  constructor(state, { file, loader = fetchProduct, clock = () => Date.now() } = {}) {
    this.state = state; this.file = file; this.loader = loader; this.clock = clock;
    state.releases ||= [];
    state.settings = { desktopNotifications: true, keepAwake: true, ...state.settings };
    this.lastPoll = new Map(); this.inflight = new Set(); this.generation = new Map(); this.saveQueue = Promise.resolve(); this.backoff = new Map(); this.lastReminder = new Map();
    // Live processes do not survive restarts. Explicitly resume after reviewing tasks.
    for (const group of state.groups) group.enabled = false;
    for (const task of state.tasks) if (['monitoring', 'scheduled', 'checking'].includes(task.status)) task.status = 'paused';
  }
  static async open(file) {
    let state;
    try { state = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; state = initialState(); }
    if (state.version !== 1 || !Array.isArray(state.groups) || !Array.isArray(state.tasks) || !Array.isArray(state.profiles)) throw new Error('Unsupported or corrupt workspace data; file was left unchanged');
    const engine = new Engine(state, { file }); await engine.save(); return engine;
  }
  save() {
    if (!this.file) return Promise.resolve();
    const contents = JSON.stringify(this.state, null, 2);
    this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(`${this.file}.tmp`, contents, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
    return this.saveQueue;
  }
  log(group, message, level = 'info') {
    this.state.logs.unshift({ id: id(), time: new Date(this.clock()).toISOString(), group: group?.name || 'Workspace', message, level });
    this.state.logs = this.state.logs.slice(0, 300);
  }
  group(groupId) { const group = this.state.groups.find(g => g.id === groupId); if (!group) throw new Error('Task group not found'); return group; }
  addGroup(value) { if (this.state.groups.length >= 30) throw new Error('Maximum 30 groups'); const group = { ...validateGroup(value), id: id() }; this.state.groups.push(group); this.log(group, 'Task group created'); return group; }
  addRelease(value) {
    if (this.state.releases.length >= 100) throw new Error('Maximum 100 release plans');
    const name = String(value.name || '').trim();
    if (!name || name.length > 120) throw new Error('Release name required (120 characters maximum)');
    const url = productHandle(value.url, value.store);
    if (!pokemonRetailers.some(s => s.id === value.store)) throw new Error('Choose a Pokémon retailer');
    if (!Number.isFinite(Date.parse(value.releaseAt)) || Date.parse(value.releaseAt) <= this.clock()) throw new Error('Choose a future release time');
    const leadMinutes = Number(value.leadMinutes ?? 10);
    if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 1440) throw new Error('Reminder lead must be 0–1440 minutes');
    const release = { id: id(), name, store: value.store, url, releaseAt: new Date(value.releaseAt).toISOString(), leadMinutes, reminded: false, launched: false };
    this.state.releases.push(release); this.log(null, `Release plan saved: ${name}`); return release;
  }
  prepareRelease(releaseId) {
    const release = this.state.releases.find(r => r.id === releaseId);
    if (!release) throw new Error('Release plan not found');
    const existing = this.state.groups.find(g => g.releaseId === releaseId);
    if (existing) return existing;
    const group = this.addGroup({ name: release.name, store: release.store, products: [release.url], sizes: ['Any'], interval: 30, quantity: 1, scheduledAt: new Date(Date.parse(release.releaseAt) - release.leadMinutes * 60000).toISOString() });
    group.releaseId = releaseId;
    if (this.state.profiles.length) this.addTasks(group.id, [this.state.profiles[0].id]);
    return group;
  }
  addProfile(value) {
    const profile = { id: id(), name: String(value.name || '').trim(), group: String(value.group || 'Everyday').trim(), email: String(value.email || '').trim(), size: String(value.size || 'Any').trim(), address: String(value.address || '').trim() };
    if (!profile.name || !profile.group || Object.values(profile).some(v => v.length > 500)) throw new Error('Profile name and group are required; fields must be under 500 characters');
    if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new Error('Invalid email address');
    if (this.state.profiles.length >= 100) throw new Error('Maximum 100 profiles');
    this.state.profiles.push(profile); return profile;
  }
  addTasks(groupId, profileIds) {
    const group = this.group(groupId);
    if (!Array.isArray(profileIds) || !profileIds.length || profileIds.some(p => !this.state.profiles.some(x => x.id === p))) throw new Error('Select existing profiles');
    const candidates = [...new Set(profileIds)].filter(profileId => !this.state.tasks.some(t => t.groupId === groupId && t.profileId === profileId));
    if (this.state.tasks.length + candidates.length > 300) throw new Error('Maximum 300 tasks');
    const created = [];
    for (const profileId of new Set(profileIds)) {
      if (this.state.tasks.some(t => t.groupId === groupId && t.profileId === profileId)) continue;
      const task = { id: id(), groupId, profileId, status: group.enabled ? 'monitoring' : 'idle', message: 'Ready to monitor', matches: [], checks: 0, lastChecked: '' };
      this.state.tasks.push(task); created.push(task);
    }
    this.log(group, `Added ${created.length} tasks`); return created;
  }
  start(groupId) {
    const group = this.group(groupId);
    const tasks = this.state.tasks.filter(t => t.groupId === groupId);
    if (!tasks.length) throw new Error('Add at least one task before starting');
    group.enabled = true; this.lastPoll.delete(groupId); this.backoff.delete(groupId);
    const scheduled = group.scheduledAt && Date.parse(group.scheduledAt) > this.clock();
    for (const task of tasks) { task.status = scheduled ? 'scheduled' : 'monitoring'; task.message = scheduled ? 'Waiting for scheduled start' : 'Waiting for next stock check'; }
    this.log(group, scheduled ? 'Tasks scheduled' : 'Monitor started');
  }
  stop(groupId) {
    const group = this.group(groupId); group.enabled = false;
    this.generation.set(groupId, (this.generation.get(groupId) || 0) + 1);
    for (const task of this.state.tasks.filter(t => t.groupId === groupId)) { task.status = 'paused'; task.message = 'Monitor paused'; }
    this.log(group, 'Monitor paused');
  }
  deleteGroup(groupId) {
    this.stop(groupId); this.state.groups = this.state.groups.filter(g => g.id !== groupId); this.state.tasks = this.state.tasks.filter(t => t.groupId !== groupId);
  }
  async pollGroup(group) {
    if (this.inflight.has(group.id)) return;
    this.inflight.add(group.id);
    const generation = this.generation.get(group.id) || 0;
    const active = () => group.enabled && this.state.groups.includes(group) && generation === (this.generation.get(group.id) || 0);
    try {
      const products = []; const errors = []; const health = [];
      for (const handle of group.products) {
        if (!active()) return;
        try { products.push(await this.loader(group, handle)); health.push({ product: handle, status: 'readable', message: 'Availability data read', checkedAt: new Date(this.clock()).toISOString() }); }
        catch (error) { errors.push(error.message); health.push({ product: handle, status: 'unknown', message: error.message, checkedAt: new Date(this.clock()).toISOString() }); }
      }
      if (!active()) return;
      group.health = health;
      const failures = errors.length ? (this.backoff.get(group.id)?.failures || 0) + 1 : 0;
      const retrySeconds = errors.length ? Math.min(900, group.interval * 2 ** Math.min(failures, 5)) : group.interval;
      this.backoff.set(group.id, { failures, retrySeconds });
      group.retrySeconds = retrySeconds;
      for (const task of this.state.tasks.filter(t => t.groupId === group.id)) {
        const profile = this.state.profiles.find(p => p.id === task.profileId);
        const desired = profile?.size && profile.size !== 'Any' ? [profile.size] : group.sizes;
        const pokemon = stores.find(s => s.id === group.store)?.kind === 'product-page';
        const matches = products.flatMap(p => p.variants.filter(v => v.available && (pokemon || desired.includes('Any') || v.options.some(o => desired.includes(o)) || desired.includes(v.title)) && (group.maxPrice == null || (Number.isFinite(v.price) && v.price <= group.maxPrice && (!v.currency || v.currency === 'USD')))).map(v => ({ product: p.title, handle: p.handle, variantId: v.id, size: v.title, price: v.price, offerStatus: v.offerStatus, url: group.store === 'demo' ? null : p.url || `https://${stores.find(s => s.id === group.store).domain}/cart/${v.id}:${group.quantity}` })));
        const previous = new Set(task.matches.map(m => `${m.handle}:${m.variantId}`));
        task.matches = matches; task.checks++; task.lastChecked = new Date(this.clock()).toISOString();
        task.status = matches.length ? 'available' : errors.length ? 'error' : 'monitoring';
        task.message = matches.length ? `${matches.length} matching offer${matches.length === 1 ? '' : 's'} available${errors.length ? `; ${errors.length} products unreadable` : ''}` : errors.length ? [...new Set(errors)].join(' · ') : 'Waiting for matching stock';
        const newMatches = matches.filter(m => !previous.has(`${m.handle}:${m.variantId}`));
        if (newMatches.length) {
          this.log(group, `${profile?.name || 'Profile'}: matching stock found`, 'success');
          if (this.state.settings.notifications) this.state.notifications.unshift({ id: id(), time: task.lastChecked, title: group.store === 'demo' ? 'Demo Pokémon stock' : 'Pokémon stock available', message: `${group.name} · ${profile?.name} · ${[...new Set(newMatches.map(m => m.product))].join(', ')}`, read: false });
        }
      }
      this.state.notifications = this.state.notifications.slice(0, 100);
      this.log(group, `Read ${products.length}/${group.products.length} products${group.store === 'demo' ? ' (simulation)' : ''}${errors.length ? `; next attempt in ${retrySeconds}s · ${errors[0]}` : ''}`, errors.length ? 'error' : 'info');
    } catch (error) {
      if (active()) {
        for (const task of this.state.tasks.filter(t => t.groupId === group.id)) { task.status = 'error'; task.message = error.message; task.matches = []; task.lastChecked = new Date(this.clock()).toISOString(); }
        this.log(group, error.message, 'error');
      }
    } finally { this.inflight.delete(group.id); await this.save(); }
  }
  async tick() {
    let remindersChanged = false;
    for (const release of this.state.releases) {
      if (!release.reminded && this.clock() >= Date.parse(release.releaseAt) - release.leadMinutes * 60000 && this.clock() <= Date.parse(release.releaseAt) + 3600000) {
        release.reminded = true; remindersChanged = true;
        if (this.state.settings.notifications) this.state.notifications.unshift({ id: id(), time: new Date(this.clock()).toISOString(), title: 'Pokémon release reminder', message: `${release.name} · ${stores.find(s => s.id === release.store)?.name} · ${new Date(release.releaseAt).toISOString()}`, read: false });
        this.log(null, `Release reminder: ${release.name}`);
      }
    }
    if (remindersChanged) { this.state.notifications = this.state.notifications.slice(0, 100); await this.save(); }
    const ready = this.state.groups.filter(g => g.enabled && (!g.scheduledAt || Date.parse(g.scheduledAt) <= this.clock()) && this.clock() - (this.lastPoll.get(g.id) ?? -Infinity) >= (this.backoff.get(g.id)?.retrySeconds ?? g.interval) * 1000);
    // Three workers prevent one slow retailer from blocking every other group.
    // Each worker reads one product at a time; profiles never multiply requests.
    let cursor = 0;
    const worker = async () => { while (cursor < ready.length) { const group = ready[cursor++]; this.lastPoll.set(group.id, this.clock()); await this.pollGroup(group); } };
    await Promise.all(Array.from({ length: Math.min(3, ready.length) }, worker));
  }
}
