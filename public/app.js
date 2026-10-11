let state, page = 'overview', activeGroup, tab = 'tasks', profileFilter = 'All profiles';
let selected = new Set(), search = '', pending = false, toastTimer, lastNotification;
const $ = (s) => document.querySelector(s);
const escape = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const storeName = (id) => state.stores.find(s => s.id === id)?.name || id;
const initials = (name) => escape(name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase());
const formatTime = (time) => time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const currentGroup = () => state.groups.find(g => g.id === activeGroup);
const button = (text, action, cls = '', extra = '') => `<button type="button" class="button ${cls}" data-action="${action}" ${extra}>${text}</button>`;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000); }
async function api(path, body) {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
}
async function refresh() {
  try {
    state = await api('state');
    if (!state.groups.some(g => g.id === activeGroup)) { activeGroup = state.groups[0]?.id; selected.clear(); }
    const newest = state.notifications[0]?.id;
    if (lastNotification && newest && newest !== lastNotification && state.settings.sound) {
      try { const Audio = window.AudioContext || window.webkitAudioContext; const audio = new Audio(); const tone = audio.createOscillator(); const volume = audio.createGain(); volume.gain.value = .03; tone.frequency.value = 700; tone.connect(volume); volume.connect(audio.destination); tone.start(); tone.stop(audio.currentTime + .12); tone.onended = () => audio.close(); } catch {}
    }
    lastNotification = newest;
    $('#group-count').textContent = state.groups.length;
    const unread = state.notifications.filter(n => !n.read).length; $('#notification-count').textContent = unread || '';
    render();
  } catch (error) { toast(error.message); if (!state) $('#content').innerHTML = '<div class="empty"><h3>Unable to connect</h3><p>Start the local server, then reload this page.</p></div>'; }
}
function title(title, description, actions = '') { return `<div class="page-head"><div><div class="eyebrow">POKÉMON DROP WORKSPACE</div><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="head-actions">${actions}</div></div>`; }
function stats() {
  const counts = [
    ['Total tasks', state.tasks.length, 'Across all task groups', '⌘'],
    ['Monitoring', state.tasks.filter(t => t.status === 'monitoring').length, '<em>●</em> Watching for matching stock', '◉'],
    ['Stock matches', state.tasks.filter(t => t.status === 'available').length, 'Includes demo results · not checkouts', '✓'],
    ['Profile groups', new Set(state.profiles.map(p => p.group)).size, `${state.profiles.length} profiles in your workspace`, '▣'],
  ];
  return `<div class="stats">${counts.map(([label, count, note, icon]) => `<div class="stat"><div class="stat-label">${label}<span class="stat-symbol">${icon}</span></div><div class="stat-number">${count.toString().padStart(2, '0')}</div><div class="stat-note">${note}</div></div>`).join('')}</div>`;
}
function logs(limit = 5) {
  return state.logs.slice(0, limit).map(log => `<div class="log-entry ${escape(log.level)}"><span class="log-dot"></span><div class="log-body"><strong>${escape(log.group)}</strong><br>${escape(log.message)}</div><span class="log-time">${formatTime(log.time)}</span></div>`).join('') || '<p class="subtitle">Your task activity will appear here.</p>';
}
function bottomPanels() {
  return `<div class="bottom-panels"><section class="panel"><div class="panel-head"><h2>Pokémon demo catalog</h2><span class="mode-tag">SIMULATION</span></div><div class="release-card"><div class="product-art">⌁</div><div class="release-info"><strong>Pokémon TCG · Demo Elite Trainer Box</strong><small>Simulated product · no real release date</small></div><span class="release-note">$49.99</span></div><div class="release-card"><div class="product-art">⌁</div><div class="release-info"><strong>Pokémon TCG · Demo Booster Bundle</strong><small>Simulated product · no real release date</small></div><span class="release-note">$26.94</span></div></section><section class="panel"><div class="panel-head"><h2>Recent activity</h2><button class="text-button" data-page="activity">View all ↗</button></div>${logs(3)}</section></div>`;
}
function taskRows(group) {
  const tasks = state.tasks.filter(t => t.groupId === group.id);
  if (!tasks.length) return `<div class="empty"><div class="empty-symbol">⌘</div><h3>A little preparation. A better release day.</h3><p>Add profiles to this group to create your first tasks.<br>Each task watches all the products in your monitor list.</p>${button('＋ Create tasks', 'new-tasks', 'primary')}</div>`;
  return `<div class="table-scroll"><table><thead><tr><th><input type="checkbox" id="select-all" aria-label="Select all tasks" ${tasks.every(t => selected.has(t.id)) ? 'checked' : ''}></th><th>Profile</th><th>Product selection</th><th>Status</th><th>Last check</th><th>Actions</th></tr></thead><tbody>${tasks.map(t => {
    const profile = state.profiles.find(p => p.id === t.profileId);
    return `<tr><td><input type="checkbox" data-task="${t.id}" aria-label="Select ${escape(profile?.name)}" ${selected.has(t.id) ? 'checked' : ''}></td><td><div class="profile-cell"><span class="profile-avatar">${initials(profile?.name || '?')}</span>${escape(profile?.name || 'Deleted profile')}</div></td><td>${group.products.length} watched products</td><td><span class="status ${escape(t.status)}" title="${escape(t.message)}">${t.status === 'available' && group.store === 'demo' ? 'Demo stock' : escape(t.status)}</span></td><td>${formatTime(t.lastChecked)}</td><td><div class="row-actions">${t.matches[0]?.url ? `<a class="cart-link" href="${escape(t.matches[0].url)}" target="_blank" rel="noopener noreferrer">Open product ↗</a>` : ''}<button data-action="task-details" data-id="${t.id}" aria-label="View task details">≡</button><button data-action="delete-task" data-id="${t.id}" aria-label="Delete task">×</button></div></td></tr>`;
  }).join('')}</tbody></table></div><div class="table-bottom"><span>${tasks.length} tasks in this group</span><span>Stock availability is not a checkout guarantee</span></div>`;
}
function monitors(group) {
  return `<div class="monitor-list">${group.products.map(handle => { const health = group.health?.find(h => h.product === handle); return `<div class="monitor-product"><div class="product-art">▣</div><div class="product-description"><div class="handle">${escape(handle)}</div><small>${escape(storeName(group.store))} · ${health ? escape(health.message) : 'Not checked yet'}</small></div><span class="status ${health?.status === 'unknown' ? 'error' : group.enabled ? 'monitoring' : ''}">${health?.status === 'unknown' ? 'Unknown' : group.enabled ? 'Watching' : 'Paused'}</span></div>`; }).join('')}<div class="config-line"><span>Monitor delay</span><strong>${group.interval} seconds</strong></div><div class="config-line"><span>Current retry interval</span><strong>${group.retrySeconds || group.interval} seconds</strong></div><div class="config-line"><span>Price ceiling</span><strong>${group.maxPrice == null ? 'No ceiling' : '$' + Number(group.maxPrice).toFixed(2)}</strong></div><div class="config-line"><span>Scheduled start</span><strong>${group.scheduledAt ? escape(new Date(group.scheduledAt).toLocaleString()) : 'Start manually'}</strong></div>${group.store === 'demo' ? `<div class="controls-inline">${button(group.demoStock ? 'Set demo out of stock' : 'Simulate restock', 'demo-stock', 'primary')}</div><p class="notice">Demo stock is generated locally. No retailer requests or purchases are made.</p>` : '<p class="notice">Live availability parsing is unverified. Blocked pages and missing stock data are unknown, not sold out. Product links open your normal retailer session; checkout is manual.</p>'}</div>`;
}
function tasksPage() {
  const group = currentGroup();
  return `${title('Drop groups', 'Pokémon products, collector profiles, and release plans. Together.', button('＋ Create group', 'new-group', 'dark'))}${stats()}<section class="workspace"><aside class="groups-pane"><div class="pane-head">Your groups <span class="count">${state.groups.length}</span></div><input class="search" id="group-search" placeholder="Search groups…" aria-label="Search task groups" value="${escape(search)}"><div id="group-list">${groupList()}</div><div class="group-footer">One monitor, multiple products.<br>Your tasks share the same stock checks.</div></aside><div class="tasks-pane">${group ? `<div class="task-top"><div><div class="task-title">${escape(group.name)}</div><div class="task-sub"><span>${escape(storeName(group.store))}</span><span>·</span><span>${group.products.length} products</span><span>·</span><span>${group.interval}s delay</span></div></div><div class="edit-actions"><span class="mode-tag">${group.store === 'demo' ? 'DEMO MODE' : 'UNVERIFIED STORE'}</span><button class="text-button" data-action="delete-group" aria-label="Delete task group">Delete group</button></div></div><div class="task-tabs"><button data-tab="tasks" class="${tab === 'tasks' ? 'active' : ''}">Tasks <span class="count">${state.tasks.filter(t => t.groupId === group.id).length}</span></button><button data-tab="monitor" class="${tab === 'monitor' ? 'active' : ''}">Monitor list</button><span class="spacer"></span>${button('＋ Add tasks', 'new-tasks', 'tiny')}</div>${tab === 'tasks' ? `<div class="task-toolbar">${button('▷ Start group', 'start', 'green tiny')}${button('□ Pause group', 'stop', 'red tiny')}${button('Delete selected', 'delete-selected', 'tiny', selected.size ? '' : 'disabled')}<span class="selection">${selected.size} selected</span></div>${taskRows(group)}` : monitors(group)}` : `<div class="empty"><div class="empty-symbol">⌘</div><h3>Your workspace starts here</h3><p>Create a task group to organize your watchlist.</p>${button('＋ Create group', 'new-group', 'primary')}</div>`}</div></section><div class="info-strip"><span>ⓘ</span><div><strong>You’re in control.</strong> Demo mode simulates restocks. Live mode reads explicit public availability and opens the retailer product page. Purchases remain manual.</div></div>${bottomPanels()}`;
}
function groupList() {
  return state.groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase())).map(g => `<button class="group-card ${g.id === activeGroup ? 'selected' : ''}" data-group="${g.id}"><div class="group-title">${escape(g.name)}<span>${g.enabled ? '◉' : '·'}</span></div><div class="group-sub"><span class="store-icon">${escape(storeName(g.store)[0])}</span>${escape(storeName(g.store))}</div><div class="group-meta"><span>${state.tasks.filter(t => t.groupId === g.id).length} tasks</span><span>${g.enabled ? '● Active' : '○ Paused'}</span></div></button>`).join('') || '<p class="subtitle">No matching groups.</p>';
}
function profilesPage() {
  const groups = ['All profiles', ...new Set(state.profiles.map(p => p.group))];
  const profiles = state.profiles.filter(p => profileFilter === 'All profiles' || p.group === profileFilter);
  return `${title('Collectors', 'Organize collector profiles and create grouped monitoring tasks.', button('＋ Add profile', 'new-profile', 'dark'))}<div class="filter-row">${groups.map(g => `<button class="filter-chip ${g === profileFilter ? 'active' : ''}" data-filter="${escape(g)}">${escape(g)}</button>`).join('')}</div><div class="profiles-grid">${profiles.map(p => `<section class="panel profile-card"><div class="profile-avatar">${initials(p.name)}</div><h3>${escape(p.name)}</h3><p>${escape(p.email || 'No email added')}<br>Pokémon sealed products</p><div class="card-actions"><span class="mode-tag">${escape(p.group)}</span><button class="text-button" data-action="delete-profile" data-id="${p.id}">Delete</button></div></section>`).join('') || '<div class="empty"><h3>No profiles yet</h3><p>Add a profile to start creating tasks.</p></div>'}</div><div class="info-strip">ⓘ Profile data is stored locally. Do not enter card details or account passwords. Profiles are not automatically submitted to retailer checkout.</div>`;
}
function overview() {
  return `${title('Your next Pokémon drop.', 'Prepare your watchlist, check retailer health, and plan your release day.')}${stats()}<section class="overview-card"><div class="eyebrow">POKÉMON TCG / DESKTOP EDITION</div><h2>Be ready when the next drop lands.</h2><p>Track Elite Trainer Boxes, booster bundles, and sealed products in one desktop workspace.<br>Plan announced releases, get reminders, and inspect live stock checks before you act.</p>${button('Open drop groups ↗', 'go-tasks', 'primary')}</section><div class="guide-steps"><div class="panel"><div class="step-number">01 / PREPARE</div><h3>Organize collectors</h3><p>Prepare your retailer accounts in your normal browser. Keep collector details organized here; no passwords or cards are stored.</p>${button('Manage collectors', 'go-profiles', 'tiny')}</div><div class="panel"><div class="step-number">02 / ORGANIZE</div><h3>Plan announced releases</h3><p>Add confirmed retailer links and a release time. Get a reminder and prepare a scheduled drop group.</p>${button('Plan a release', 'new-release', 'tiny')}</div><div class="panel"><div class="step-number">03 / MONITOR</div><h3>Watch for stock</h3><p>Inspect stock matches and retailer errors. Use one-click product handoff when stock is readable.</p>${button('View activity', 'go-activity', 'tiny')}</div></div>${bottomPanels()}`;
}
function settings() {
  return `${title('Settings', 'Keep your Pokémon workspace ready for release day.')}<div class="settings-grid"><section class="panel"><h2>Alerts & desktop behavior</h2>${[['notifications', 'Stock alerts & release reminders', 'Alert on new readable stock and planned release times.'], ['desktopNotifications', 'Windows desktop notifications', 'Show an OS notification even while the app is in the tray.'], ['sound', 'Notification sound', 'Play a sound for new alerts.'], ['keepAwake', 'Keep awake while monitoring', 'Prevent automatic sleep while active. Closing the window hides it in the tray; quitting stops monitoring.']].map(([key, label, help]) => `<label class="setting-row"><span>${label}<small>${help}</small></span><input type="checkbox" data-setting="${key}" ${state.settings[key] ? 'checked' : ''}></label>`).join('')}</section><section class="panel"><h2>Current capabilities</h2>${[['Pokémon drop and collector groups', 'Working'], ['Release planner & reminders', 'Working'], ['Desktop notifications & tray', state.desktop ? 'Desktop mode' : 'Desktop app required'], ['Demo stock monitoring', 'Working'], ['Live retailer availability', 'Unverified'], ['Product handoff', 'For readable live matches'], ['Automated checkout', 'Not implemented']].map(([name, status]) => `<div class="capability"><span>${name}</span><em>${status}</em></div>`).join('')}</section><section class="panel"><h2>Workspace data</h2><p class="notice">The desktop app saves your workspace under your Windows user account. No cards, passwords, or proxy credentials are collected. Monitors pause after a restart; review and resume them yourself.</p>${button('Export configuration ↓', 'export', 'tiny')}<p class="notice">Export includes group settings, release plans, and collector names, without emails or address notes.</p></section><section class="panel"><h2>About Summit</h2><p class="notice">An independent Pokémon-focused desktop app. It is not affiliated with Alpine, Pokémon, or any retailer. Successful alerts and stock checks do not guarantee a purchase.</p><div class="capability"><span>Version</span><em>0.2.0 desktop</em></div></section></div>`;
}
function releasesPage() {
  const releases = [...state.releases].sort((a, b) => Date.parse(a.releaseAt) - Date.parse(b.releaseAt));
  return `${title('Release planner', 'Add confirmed Pokémon release times. No dates are invented or auto-discovered.', button('＋ Plan release', 'new-release', 'dark'))}<div class="profiles-grid">${releases.map(r => `<section class="panel release-plan"><span class="mode-tag">${escape(storeName(r.store))}</span><h3>${escape(r.name)}</h3><p class="notice">${escape(new Date(r.releaseAt).toLocaleString())}<br>Reminder ${r.leadMinutes} minutes before · ${r.reminded ? 'Sent' : 'Pending'}</p><a class="text-button" href="${escape(r.url)}" target="_blank" rel="noopener noreferrer">Open product ↗</a><div class="card-actions controls-inline">${button('Prepare monitor', 'prepare-release', 'primary tiny', `data-id="${r.id}"`)}${button('Delete', 'delete-release', 'tiny', `data-id="${r.id}"`)}</div></section>`).join('') || `<div class="panel empty"><div class="empty-symbol">▦</div><h3>Plan the next drop</h3><p>Add a retailer product link and an announced release time.<br>You will get a reminder before it starts.</p>${button('＋ Plan release', 'new-release', 'primary')}</div>`}</div><div class="info-strip">ⓘ Prepare monitor creates a scheduled group using your first collector profile. You still need to start that group. Reminders require Summit to remain running; they are not sent when your computer is off.</div>`;
}
function retailersPage() {
  return `${title('Retailers', 'Prioritized for Pokémon TCG. Live monitoring must be verified on each product page.')}<div class="profiles-grid">${state.stores.filter(s => s.kind === 'product-page').map(s => `<section class="panel retailer-card"><div class="profile-avatar">${initials(s.name)}</div><h3>${escape(s.name)}</h3><span class="mode-tag">LIVE PARSER / UNVERIFIED</span><p class="notice">Reads explicit product availability when the public page provides it. Retailer verification or missing stock data pauses reliable results.</p><a class="button tiny" href="${escape(s.home)}" target="_blank" rel="noopener noreferrer">Browse Pokémon products ↗</a></section>`).join('')}</div><div class="info-strip">ⓘ Sign into retailers in your normal browser before a drop. Summit does not store retailer passwords, bypass queues, or submit payments. Check the seller, price, and purchase limit at checkout.</div>`;
}
function newRelease() {
  modal('Plan Pokémon release', `<form id="release-form"><div class="modal-body"><div class="modal-note">Use a confirmed retailer announcement. Times use your computer’s local time zone.</div><label class="form-field">Release name<input name="name" placeholder="e.g. Elite Trainer Box restock" required maxlength="120"></label><label class="form-field">Retailer<select name="store">${state.stores.filter(s => s.kind === 'product-page').map(s => `<option value="${s.id}">${escape(s.name)}</option>`).join('')}</select></label><label class="form-field">Product link<input name="url" type="url" placeholder="https://www.pokemoncenter.com/product/..." required></label><div class="form-row"><label class="form-field">Announced release time<input name="releaseAt" type="datetime-local" required></label><label class="form-field">Remind me before (minutes)<input name="leadMinutes" type="number" min="0" max="1440" value="10" required></label></div><div class="error-message" id="form-error" role="alert"></div></div><div class="modal-footer">${button('Cancel', 'close-modal')}<button class="button primary" type="submit">Save release</button></div></form>`);
}
function integrationPage() {
  const details = {
    accounts: ['Accounts', '♙', 'Retailer account integrations need store-specific login flows and secure credential storage. This version does not collect passwords or claim to sign into stores.', ['Store-specific authentication', 'Secure session storage', 'Account status and renewal']],
    proxies: ['Proxies', '⇄', 'Proxy routing is not implemented. Current public stock requests use the server’s normal connection. No proxy credentials are collected.', ['Named proxy pools', 'Connection health checks', 'Explicit routing configuration']],
    captcha: ['CAPTCHA', '▧', 'This version has no CAPTCHA solver or challenge automation. Live retailer challenges stop the request; you can finish supported cart handoff in your own browser.', ['Visible challenge status', 'Manual browser handoff', 'Integration readiness checks']],
  }[page];
  return `${title(details[0], 'Integration status and upcoming capabilities.')}<section class="panel placeholder-panel"><div class="empty-symbol">${details[1]}</div><span class="mode-tag">NOT IMPLEMENTED</span><h2>Planned integration</h2><p>${details[2]}</p><div class="help-list">${details[3].map(item => `<div>○ &nbsp; ${item}</div>`).join('')}</div>${button('View working capabilities', 'go-settings', 'primary')}</section>`;
}
function render() {
  if (!state) return;
  const labels = { tasks: 'Drop groups', overview: 'Drop radar', profiles: 'Collectors', releases: 'Release planner', retailers: 'Retailers', activity: 'Activity', settings: 'Settings', accounts: 'Accounts', proxies: 'Proxies', captcha: 'CAPTCHA' };
  $('#breadcrumb').textContent = labels[page];
  document.querySelectorAll('.sidebar [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  // Keep a search field's focus across background refreshes.
  const focusedSearch = document.activeElement?.id === 'group-search'; const cursor = focusedSearch ? document.activeElement.selectionStart : 0;
  $('#content').innerHTML = page === 'tasks' ? tasksPage() : page === 'releases' ? releasesPage() : page === 'retailers' ? retailersPage() : page === 'profiles' ? profilesPage() : page === 'overview' ? overview() : page === 'settings' ? settings() : page === 'activity' ? `${title('Activity', 'A clear record of your monitors, stock checks, and task changes.')}<section class="panel">${logs(100)}</section>` : integrationPage();
  if (focusedSearch && $('#group-search')) { $('#group-search').focus(); $('#group-search').setSelectionRange(cursor, cursor); }
}
function modal(title, body, footer = '') {
  $('#modal-content').innerHTML = `<div class="modal-header"><h2>${title}</h2><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></div>${body}${footer ? `<div class="modal-footer">${footer}</div>` : ''}`;
  $('#modal').showModal();
}
function newGroup() {
  modal('Create task group', `<form id="group-form"><div class="modal-body"><label class="form-field">Group name<input name="name" placeholder="e.g. Friday release" required maxlength="80"></label><label class="form-field">Store<select name="store">${state.stores.filter(s => !s.legacy).map(s => `<option value="${s.id}">${escape(s.name)}${s.id === 'demo' ? ' · simulated catalog' : ' · unverified integration'}</option>`).join('')}</select></label><label class="form-field">Product handles or URLs<textarea name="products" placeholder="demo-elite-trainer-box\ndemo-booster-bundle" required></textarea><small>One per line, up to 10. Use full product links for Pokémon Center, Target, or Walmart. Demo accepts demo-elite-trainer-box and demo-booster-bundle.</small></label><div class="form-row"><label class="form-field">Price ceiling ($, optional)<input name="maxPrice" type="number" min="0.01" max="10000" step="0.01" placeholder="e.g. 59.99"><input name="sizes" value="Any" type="hidden"><small>Unknown prices do not match a price ceiling.</small></label><label class="form-field">Quantity<input name="quantity" type="number" min="1" max="5" value="1" required></label></div><div class="form-row"><label class="form-field">Monitor delay (seconds)<input name="interval" type="number" min="30" max="3600" value="30" required></label><label class="form-field">Scheduled start (optional)<input name="scheduledAt" type="datetime-local"></label></div><div class="error-message" id="form-error" role="alert"></div></div><div class="modal-footer">${button('Cancel', 'close-modal')}<button class="button primary" type="submit">Create group</button></div></form>`);
}
function newProfile() {
  modal('Add profile', `<form id="profile-form"><div class="modal-body"><div class="modal-note">Collector contact details only. Do not enter payment information or passwords.</div><label class="form-field">Profile name<input name="name" placeholder="Personal" required maxlength="80"></label><label class="form-field">Profile group<input name="group" value="Pokémon" required maxlength="80" list="profile-groups"><datalist id="profile-groups">${[...new Set(state.profiles.map(p => p.group))].map(g => `<option value="${escape(g)}">`).join('')}</datalist></label><div class="form-row"><label class="form-field">Email (optional)<input name="email" type="email" autocomplete="off" maxlength="200"></label><input name="size" value="Any" type="hidden"></div><label class="form-field">Address notes (optional)<textarea name="address" maxlength="500" autocomplete="off"></textarea></label><div class="error-message" id="form-error" role="alert"></div></div><div class="modal-footer">${button('Cancel', 'close-modal')}<button class="button primary" type="submit">Save profile</button></div></form>`);
}
function newTasks() {
  if (!currentGroup()) return toast('Create a task group first');
  const existing = new Set(state.tasks.filter(t => t.groupId === activeGroup).map(t => t.profileId));
  const profiles = state.profiles.filter(p => !existing.has(p.id));
  const groups = [...new Set(profiles.map(p => p.group))];
  modal('Create tasks', `<form id="tasks-form"><div class="modal-body"><p class="subtitle">Select profiles for ${escape(currentGroup().name)}. One task is created per profile.</p><div class="filter-row controls-inline">${groups.map(g => `<button type="button" class="filter-chip" data-select-profile-group="${escape(g)}">Select ${escape(g)}</button>`).join('')}</div>${profiles.map(p => `<label class="profile-option"><input type="checkbox" name="profileIds" value="${p.id}" data-profile-group="${escape(p.group)}"><span class="profile-avatar">${initials(p.name)}</span><span>${escape(p.name)}<small>${escape(p.group)} · Pokémon products</small></span></label>`).join('') || '<p class="notice">All profiles already have tasks in this group. Add another profile to create more.</p>'}<div class="error-message" id="form-error" role="alert"></div></div><div class="modal-footer">${button('Cancel', 'close-modal')}<button class="button primary" type="submit" ${profiles.length ? '' : 'disabled'}>Create tasks</button></div></form>`);
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button, [data-group]'); if (!target || pending) return;
  if (target.dataset.page) { page = target.dataset.page; render(); return; }
  if (target.dataset.group) { activeGroup = target.dataset.group; selected.clear(); render(); return; }
  if (target.dataset.tab) { tab = target.dataset.tab; render(); return; }
  if (target.dataset.filter) { profileFilter = target.dataset.filter; render(); return; }
  if (target.dataset.selectProfileGroup) { document.querySelectorAll('[data-profile-group]').forEach(input => { if (input.dataset.profileGroup === target.dataset.selectProfileGroup) input.checked = true; }); return; }
  const action = target.dataset.action;
  if (action?.startsWith('go-')) { page = action.slice(3); render(); return; }
  if (action === 'new-group') return newGroup();
  if (action === 'new-profile') return newProfile();
  if (action === 'new-tasks') return newTasks();
  if (action === 'new-release') return newRelease();
  if (action === 'close-modal') return $('#modal').close();
  if (action === 'export') {
    const data = { version: 1, groups: state.groups.map(({ name, store, products, interval, sizes, quantity, maxPrice, scheduledAt }) => ({ name, store, products, interval, sizes, quantity, maxPrice, scheduledAt })), profiles: state.profiles.map(({ name, group, size }) => ({ name, group, size })), releases: state.releases };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'summit-configuration.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
  }
  if (action === 'task-details') {
    const task = state.tasks.find(t => t.id === target.dataset.id);
    return modal('Task details', `<div class="modal-body"><div class="modal-note">${escape(task.message)}</div><div class="config-line"><span>Status</span><strong>${escape(task.status)}</strong></div><div class="config-line"><span>Completed checks</span><strong>${task.checks}</strong></div><div class="config-line"><span>Last check</span><strong>${formatTime(task.lastChecked)}</strong></div>${task.matches.map(m => `<div class="monitor-product"><div><h3>${escape(m.product)}</h3><small>${m.price == null ? 'Price unknown' : '$' + Number(m.price).toFixed(2)}${m.offerStatus ? ' · ' + escape(m.offerStatus) : ''}</small>${m.url ? `<a class="cart-link" href="${escape(m.url)}" target="_blank" rel="noopener noreferrer">Open retailer product ↗</a>` : '<small>Simulated result · no real cart</small>'}</div></div>`).join('')}</div>`, button('Close', 'close-modal'));
  }
  if (target.id === 'notification-button') {
    modal('Notifications', `<div class="modal-body">${state.notifications.map(n => `<div class="notification-item"><h3>${escape(n.title)}</h3><p>${escape(n.message)}</p><small>${escape(new Date(n.time).toLocaleString())}</small></div>`).join('') || '<p class="subtitle">No notifications yet. New stock matches will appear here.</p>'}</div>`, button('Close', 'close-modal'));
    await api('notifications/read', {}); await refresh(); return;
  }
  if (!action) return;
  pending = true;
  try {
    if (action === 'start' || action === 'stop' || action === 'demo-stock') { await api(action, { id: activeGroup }); toast(action === 'start' ? 'Group started — monitoring all products' : action === 'stop' ? 'Group paused' : 'Demo stock changed; active tasks update on the next check'); }
    if (action === 'delete-group' && confirm('Delete this group and all its tasks?')) { await api('groups/delete', { id: activeGroup }); selected.clear(); }
    if (action === 'delete-task') { await api('tasks/delete', { ids: [target.dataset.id] }); selected.delete(target.dataset.id); }
    if (action === 'delete-selected' && confirm(`Delete ${selected.size} selected tasks?`)) { await api('tasks/delete', { ids: [...selected] }); selected.clear(); }
    if (action === 'delete-profile' && confirm('Delete this profile?')) await api('profiles/delete', { id: target.dataset.id });
    if (action === 'delete-release' && confirm('Delete this release reminder? Prepared monitoring groups remain until you delete them separately.')) await api('releases/delete', { id: target.dataset.id });
    if (action === 'prepare-release') { const group = await api('releases/prepare', { id: target.dataset.id }); activeGroup = group.id; page = 'tasks'; tab = 'tasks'; selected.clear(); toast('Monitor prepared. Start the group to activate the schedule.'); }
    await refresh();
  } catch (error) { toast(error.message); } finally { pending = false; }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.dataset.task) { target.checked ? selected.add(target.dataset.task) : selected.delete(target.dataset.task); render(); }
  if (target.id === 'select-all') { state.tasks.filter(t => t.groupId === activeGroup).forEach(t => target.checked ? selected.add(t.id) : selected.delete(t.id)); render(); }
  if (target.dataset.setting) { try { await api('settings', { [target.dataset.setting]: target.checked }); await refresh(); } catch (error) { toast(error.message); } }
});
document.addEventListener('input', event => { if (event.target.id === 'group-search') { search = event.target.value; $('#group-list').innerHTML = groupList(); } });
document.addEventListener('submit', async event => {
  event.preventDefault(); if (pending) return;
  const form = event.target; const data = Object.fromEntries(new FormData(form)); pending = true;
  try {
    if (form.id === 'group-form') { data.products = data.products.split(/\r?\n/).map(s => s.trim()).filter(Boolean); data.sizes = ['Any']; data.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt).toISOString() : ''; const group = await api('groups', data); activeGroup = group.id; selected.clear(); page = 'overview'; }
    if (form.id === 'profile-form') await api('profiles', data);
    if (form.id === 'tasks-form') await api('tasks', { groupId: activeGroup, profileIds: new FormData(form).getAll('profileIds') });
    if (form.id === 'release-form') { data.releaseAt = new Date(data.releaseAt).toISOString(); await api('releases', data); page = 'releases'; }
    $('#modal').close(); await refresh(); toast('Saved to your workspace');
  } catch (error) { $('#form-error').textContent = error.message; } finally { pending = false; }
});
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) $('#modal').close(); });
await refresh();
setInterval(() => { if (!pending && !$('#modal').open) refresh(); }, 2500);
