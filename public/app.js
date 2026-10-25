const state = { me: null, tenders: [], tasks: [], members: [], view: 'overview', search: '', filter: '' };
const $ = selector => document.querySelector(selector);
const labels = {
  new: 'Naujas', evaluating: 'Vertiname', preparing: 'Ruošiame',
  submitted: 'Pateiktas', won: 'Laimėtas', lost: 'Nelaimėtas'
};
const views = { overview: 'Apžvalga', tenders: 'Konkursai', tasks: 'Užduotys', team: 'Komanda', billing: 'Planas ir mokėjimai' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmtDate = value => value ? new Intl.DateTimeFormat('lt-LT', {
  year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
}).format(new Date(value + 'T00:00:00Z')) : '—';
const fmtMoney = value => value == null ? '—' : new Intl.NumberFormat('lt-LT', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0
}).format(value);
const toast = (message, error = false) => {
  const element = $('#toast');
  element.textContent = message;
  element.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.className = 'toast', 4500);
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Serveris neatsakė tinkamai.'); }
  if (!response.ok) throw new Error(result.error || 'Užklausa nepavyko.');
  return result;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });

async function boot() {
  try {
    state.me = await api('/api/me');
    if (state.me.user) await loadApp();
    else showAuth();
  } catch (error) {
    showAuth();
    toast(error.message, true);
  }
}
function showAuth() {
  $('#auth-view').hidden = false;
  $('#app-view').hidden = true;
}
async function loadApp() {
  const [tenders, tasks, members] = await Promise.all([
    api('/api/tenders'), api('/api/tasks'), api('/api/members')
  ]);
  state.tenders = tenders.tenders;
  state.tasks = tasks.tasks;
  state.members = members.members;
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
  $('#workspace-name').textContent = state.me.organization.name;
  $('#profile-name').textContent = state.me.user.name;
  $('#profile-role').textContent = state.me.user.role === 'owner' ? 'Administratorius' : 'Komandos narys';
  $('#avatar').textContent = state.me.user.name.trim().slice(0, 1).toUpperCase();
  $('#plan-pill').textContent = state.me.organization.plan === 'pro' ? 'PRO PLANAS' : 'NEMOKAMAS';
  $('#plan-pill').classList.toggle('pro', state.me.organization.plan === 'pro');
  $('#today').textContent = new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
  render();
}
function heading(eyebrow, title, description, button = '') {
  return `<div class="page-heading"><div><span class="eyebrow">` + eyebrow +
    `</span><h1>` + title + `</h1><p>` + description +
    `</p></div>` + button + `</div>`;
}
function statusBadge(status) {
  return `<span class="status ` + escapeHtml(status) + `">` + (labels[status] || status) + `</span>`;
}
function tenderTable(items, compact = false) {
  if (!items.length) return `<div class="empty"><div class="empty-icon">◇</div><strong>Kol kas konkursų nėra</strong>Pridėkite pirmąjį konkursą ir pradėkite planuoti darbą.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>KONKURSAS</th><th>ORGANIZACIJA</th><th>TERMINAS</th><th>BŪSENA</th>` +
    (compact ? '' : `<th>VERTĖ</th><th></th>`) + `</tr></thead><tbody>` + items.map(t => `
    <tr><td class="title-cell" title="` + escapeHtml(t.title) + `">` + escapeHtml(t.title) + `</td>
    <td>` + escapeHtml(t.buyer || '—') + `</td><td>` + fmtDate(t.deadline) + `</td>
    <td>` + statusBadge(t.status) + `</td>` +
    (compact ? '' : `<td>` + fmtMoney(t.value_eur) + `</td><td><div class="actions">
      <button class="row-action" data-action="edit-tender" data-id="` + t.id + `">Redaguoti</button>
      <button class="row-action" data-action="delete-tender" data-id="` + t.id + `">Šalinti</button>
    </div></td>`) + `</tr>`).join('') + `</tbody></table></div>`;
}
function taskList(items, max = null) {
  const selected = max ? items.slice(0, max) : items;
  if (!selected.length) return `<div class="empty"><div class="empty-icon">☑</div><strong>Užduočių dar nėra</strong>Pridėkite užduotį prie konkurso.</div>`;
  return selected.map(task => {
    const tender = state.tenders.find(item => item.id === task.tender_id);
    return `<div class="task-row ` + (task.done ? 'done' : '') + `">
      <input type="checkbox" aria-label="Pažymėti atliktą užduotį" data-action="toggle-task" data-id="` + task.id + `" ` + (task.done ? 'checked' : '') + `>
      <div class="task-info"><strong>` + escapeHtml(task.title) + `</strong><small>` +
      escapeHtml(tender?.title || '') + (task.due_date ? ' · iki ' + fmtDate(task.due_date) : '') +
      `</small></div><button aria-label="Šalinti užduotį" title="Šalinti" data-action="delete-task" data-id="` + task.id + `">×</button></div>`;
  }).join('');
}
function renderOverview() {
  const active = state.tenders.filter(t => !['won', 'lost'].includes(t.status));
  const today = new Date().toISOString().slice(0, 10);
  const soon = active.filter(t => t.deadline && t.deadline >= today &&
    (new Date(t.deadline) - new Date(today)) / 86400000 <= 14);
  const won = state.tenders.filter(t => t.status === 'won');
  const openTasks = state.tasks.filter(t => !t.done);
  const stats = [
    ['Aktyvūs konkursai', active.length, 'Šiuo metu vykdomi', '▤'],
    ['Artėjantys terminai', soon.length, 'Per artimiausias 14 dienų', '◷'],
    ['Atviros užduotys', openTasks.length, 'Komandos darbų sąraše', '☑'],
    ['Laimėti konkursai', won.length, 'Iki šiol', '✦']
  ];
  return heading('JŪSŲ DARBO ERDVĖ', 'Labas, ' + escapeHtml(state.me.user.name.split(' ')[0]) + ' 👋',
    'Svarbiausi jūsų komandos darbai viename vaizde.',
    `<button class="button primary" data-action="new-tender">+ Naujas konkursas</button>`) +
    `<div class="stats-grid">` + stats.map(([name, value, caption, icon]) =>
      `<div class="stat-card"><div class="stat-top"><span>` + name +
      `</span><span class="stat-icon">` + icon + `</span></div><div class="stat-number">` +
      value + `</div><div class="stat-caption">` + caption + `</div></div>`).join('') + `</div>
    <div class="section-heading"><h2>Darbo eiga</h2><button class="text-link" data-view="tenders">Visi konkursai →</button></div>
    <div class="two-col"><div class="panel"><div class="panel-head"><h2>Artimiausi konkursai</h2><span class="muted-small">PAGAL TERMINĄ</span></div>` +
    tenderTable(active.slice(0, 5), true) + `</div><div class="panel"><div class="panel-head"><h2>Komandos užduotys</h2><button class="text-link" data-view="tasks">Visos →</button></div>` +
    taskList(openTasks, 5) + `</div></div>`;
}
function renderTenders() {
  const items = state.tenders.filter(t =>
    (!state.filter || t.status === state.filter) &&
    (!state.search || [t.title, t.buyer, t.reference].some(v =>
      String(v).toLocaleLowerCase('lt').includes(state.search.toLocaleLowerCase('lt')))));
  return heading('GALIMYBIŲ VALDYMAS', 'Konkursai', 'Sekite visą kelią nuo galimybės iki rezultato.',
    `<button class="button primary" data-action="new-tender">+ Naujas konkursas</button>`) +
    `<div class="panel"><div class="list-toolbar"><input class="search" id="search" placeholder="Ieškoti konkursų..." value="` +
      escapeHtml(state.search) + `"><select class="filter" id="filter">
      <option value="">Visos būsenos</option>` + Object.entries(labels).map(([key, value]) =>
        `<option value="` + key + `" ` + (state.filter === key ? 'selected' : '') + `>` + value + `</option>`).join('') +
    `</select></div>` + tenderTable(items) + `</div><p class="muted-small">` +
    state.tenders.length + (state.me.organization.plan === 'pro' ? ' konkursai · Pro planas' : ' iš 3 nemokamų konkursų') + `</p>`;
}
function renderTasks() {
  return heading('KOMANDOS PLANAS', 'Užduotys', 'Maži žingsniai, padedantys laiku pateikti stiprų pasiūlymą.',
    `<button class="button primary" data-action="new-task" ` + (!state.tenders.length ? 'disabled' : '') +
    `>+ Nauja užduotis</button>`) +
    `<div class="panel"><div class="panel-head"><h2>Visos užduotys</h2><span class="muted-small">` +
    state.tasks.filter(t => !t.done).length + ` NEATLIKTOS</span></div>` + taskList(state.tasks) + `</div>`;
}
function renderTeam() {
  const owner = state.me.user.role === 'owner';
  return heading('BENDRAS DARBAS', 'Komanda', 'Pakvieskite kolegas dirbti su tais pačiais konkursais.') +
    `<div class="two-col"><div class="panel"><div class="panel-head"><h2>Komandos nariai</h2><span class="muted-small">` +
    state.members.length + ` NARIAI</span></div>` + state.members.map(member =>
    `<div class="task-row"><div class="avatar">` + escapeHtml(member.name.slice(0, 1).toUpperCase()) +
    `</div><div class="task-info"><strong>` + escapeHtml(member.name) +
    `</strong><small>` + escapeHtml(member.email) + `</small></div><span class="status">` +
    (member.role === 'owner' ? 'Administratorius' : 'Narys') + `</span></div>`).join('') +
    `</div><div class="info-card"><span class="eyebrow">AUGINKITE KOMANDĄ</span><h2>Dirbkite kartu</h2><p>Vienkartinis pakvietimo kodas galioja 7 dienas. Jį įvedęs kolega prisijungs prie jūsų darbo erdvės.</p>` +
    (owner ? `<button class="button dark" data-action="invite">Sukurti pakvietimo kodą</button><div id="invite-output"></div>` :
      `<p class="notice">Pakvietimus gali kurti komandos administratorius.</p>`) + `</div></div>`;
}
function renderBilling() {
  const pro = state.me.organization.plan === 'pro';
  const owner = state.me.user.role === 'owner';
  const configured = state.me.billingConfigured;
  return heading('PLANAS IR MOKĖJIMAI', 'Augkite savo tempu',
    'Paprastas planas jūsų komandos konkursų valdymui.') +
    `<div class="billing-grid"><div class="info-card"><span class="plan-label">PRADŽIAI</span><div class="price">Nemokamai</div><p>Viskas, ko reikia pradėti.</p><ul class="feature-list"><li>Iki 3 konkursų</li><li>Užduotys ir terminai</li><li>Bendra komandos erdvė</li></ul>` +
    (!pro ? `<span class="status">DABARTINIS PLANAS</span>` : '') +
    `</div><div class="info-card highlight"><span class="plan-label">AUGANČIAI KOMANDAI</span><div class="price">Pro <small>/ mėnesį</small></div><p>Neriboti konkursai jūsų komandai. Kaina rodoma saugiame „Stripe“ atsiskaitymo lange.</p><ul class="feature-list"><li>Neriboti konkursai</li><li>Užduotys ir terminai</li><li>Komandos narių pakvietimai</li><li>Prenumeratos valdymas per „Stripe“</li></ul>` +
    (pro ? `<span class="status won">AKTYVUS PLANAS</span>` : owner && configured ?
      `<button class="button primary" data-action="checkout">Pasirinkti Pro →</button>` :
      `<button class="button primary" disabled>Pasirinkti Pro</button>`) +
    `</div></div>` +
    (!configured ? `<div class="notice">Mokėjimai bus prieinami administratoriui, kai bus sukonfigūruota „Stripe“ paskyra, mėnesinė kaina ir webhook.</div>` : '') +
    (owner && state.me.organization.subscriptionStatus ?
      `<div class="section-heading"><h2>Prenumeratos valdymas</h2></div><div class="info-card"><p>Dabartinė būsena: <strong>` +
      escapeHtml(state.me.organization.subscriptionStatus) +
      `</strong>. Sąskaitas ir atšaukimą tvarkykite „Stripe“ portale.</p><button class="button dark" data-action="portal">Atidaryti mokėjimų portalą</button></div>` : '');
}
function render() {
  document.querySelectorAll('.nav button').forEach(button =>
    button.classList.toggle('active', button.dataset.view === state.view));
  $('#breadcrumb-title').textContent = views[state.view];
  $('#content').innerHTML = ({
    overview: renderOverview, tenders: renderTenders, tasks: renderTasks,
    team: renderTeam, billing: renderBilling
  })[state.view]();
}
async function refresh() {
  state.me = await api('/api/me');
  await loadApp();
}
function openTender(id) {
  const form = $('#tender-form');
  form.reset();
  const tender = state.tenders.find(t => t.id === id);
  $('#tender-form-title').textContent = tender ? 'Redaguoti konkursą' : 'Naujas konkursas';
  if (tender) {
    for (const [key, value] of Object.entries({
      id: tender.id, title: tender.title, buyer: tender.buyer, reference: tender.reference,
      description: tender.description, deadline: tender.deadline, status: tender.status,
      valueEur: tender.value_eur
    })) form.elements[key].value = value ?? '';
  }
  $('#tender-dialog').showModal();
}
function openTask() {
  if (!state.tenders.length) return toast('Pirmiausia sukurkite konkursą.', true);
  const form = $('#task-form');
  form.reset();
  form.elements.tenderId.innerHTML = state.tenders.map(t =>
    `<option value="` + t.id + `">` + escapeHtml(t.title) + `</option>`).join('');
  $('#task-dialog').showModal();
}
function setAuthMode(register) {
  $('#register-fields').hidden = !register;
  $('#auth-title').textContent = register ? 'Sukurkite darbo erdvę' : 'Prisijunkite prie savo komandos';
  $('#auth-subtitle').textContent = register ?
    'Pradėkite nemokamai. Iki trijų konkursų ir visa komanda vienoje vietoje.' :
    'Jūsų konkursai laukia. Tęskite ten, kur sustojote.';
  $('#auth-submit').innerHTML = register ? 'Sukurti paskyrą <span>→</span>' :
    'Prisijungti <span>→</span>';
  $('#auth-switch-line').innerHTML = register ?
    'Jau turite paskyrą? <button type="button" id="auth-switch">Prisijungti</button>' :
    'Dar neturite paskyros? <button type="button" id="auth-switch">Sukurti paskyrą</button>';
  $('#auth-form').dataset.register = String(register);
  $('#auth-form').reset();
}
$('#auth-switch-line').addEventListener('click', event => {
  if (event.target.id === 'auth-switch') setAuthMode($('#auth-form').dataset.register !== 'true');
});
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const register = form.dataset.register === 'true';
  try {
    await post(register ? '/api/register' : '/api/login', values);
    state.me = await api('/api/me');
    await loadApp();
    toast(register ? 'Darbo erdvė sukurta.' : 'Sveiki sugrįžę!');
  } catch (error) { toast(error.message, true); }
});
$('#logout').addEventListener('click', async () => {
  try {
    await post('/api/logout', {});
    state.me = null;
    showAuth();
    setAuthMode(false);
  } catch (error) { toast(error.message, true); }
});
document.querySelectorAll('[data-close]').forEach(button =>
  button.addEventListener('click', () => $('#' + button.dataset.close).close()));
document.querySelectorAll('.nav button').forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  render();
}));
$('#content').addEventListener('input', event => {
  if (event.target.id === 'search') {
    state.search = event.target.value;
    const position = event.target.selectionStart;
    render();
    $('#search').focus();
    $('#search').setSelectionRange(position, position);
  }
});
$('#content').addEventListener('change', async event => {
  if (event.target.id === 'filter') {
    state.filter = event.target.value;
    render();
  }
  if (event.target.dataset.action === 'toggle-task') {
    try {
      await api('/api/tasks/' + event.target.dataset.id, {
        method: 'PATCH', body: JSON.stringify({ done: event.target.checked })
      });
      await refresh();
    } catch (error) { toast(error.message, true); }
  }
});
$('#content').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) { state.view = button.dataset.view; return render(); }
  const action = button.dataset.action;
  try {
    if (action === 'new-tender') openTender();
    if (action === 'edit-tender') openTender(button.dataset.id);
    if (action === 'new-task') openTask();
    if (action === 'delete-tender' && confirm('Pašalinti konkursą ir visas jo užduotis?')) {
      await api('/api/tenders/' + button.dataset.id, { method: 'DELETE' });
      await refresh(); toast('Konkursas pašalintas.');
    }
    if (action === 'delete-task' && confirm('Pašalinti užduotį?')) {
      await api('/api/tasks/' + button.dataset.id, { method: 'DELETE' });
      await refresh(); toast('Užduotis pašalinta.');
    }
    if (action === 'invite') {
      const result = await post('/api/invite', {});
      $('#invite-output').innerHTML = '<div class="code-box">' + escapeHtml(result.code) +
        '</div><p class="muted-small">Nusiųskite šį kodą kolegai saugiu kanalu. Galioja 7 dienas ir tik vienam prisijungimui.</p>';
    }
    if (action === 'checkout' || action === 'portal') {
      const result = await post('/api/billing/' + action, {});
      if (result.url) location.assign(result.url);
    }
  } catch (error) { toast(error.message, true); }
});
$('#tender-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  const id = body.id;
  delete body.id;
  try {
    if (id) await api('/api/tenders/' + id, { method: 'PATCH', body: JSON.stringify(body) });
    else await post('/api/tenders', body);
    $('#tender-dialog').close();
    await refresh();
    toast('Konkursas išsaugotas.');
  } catch (error) {
    if (error.message.includes('3 konkursų')) state.view = 'billing';
    toast(error.message, true);
    if (state.view === 'billing') { $('#tender-dialog').close(); render(); }
  }
});
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await post('/api/tasks', Object.fromEntries(new FormData(event.currentTarget)));
    $('#task-dialog').close();
    await refresh();
    toast('Užduotis sukurta.');
  } catch (error) { toast(error.message, true); }
});
boot();
