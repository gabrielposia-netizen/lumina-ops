import { api, can, clearToken, getToken } from './api.js';
import { esc, icon, longDate } from './ui.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderProductForm, renderProducts } from './pages/products.js';
import { renderInbound } from './pages/inbound.js';
import { renderStock } from './pages/stock.js';
import { renderKits } from './pages/kits.js';
import { renderProduction } from './pages/production.js';
import { renderMaterials } from './pages/materials.js';
import { renderLabels } from './pages/labels.js';
import { renderExpedition } from './pages/expedition.js';
import { renderProductivity } from './pages/productivity.js';
import { renderInventory } from './pages/inventory.js';
import { renderReports } from './pages/reports.js';
import { renderAi } from './pages/ai.js';
import { renderSettings } from './pages/settings.js';

const MENU = [
  ['', 'Dashboard', 'home', 'dashboard'],
  ['produtos', 'Produtos', 'box', 'products'],
  ['recebimento', 'Recebimento', 'inbox', 'entries'],
  ['estoque', 'Estoque', 'layers', 'stock'],
  ['kits', 'Kits e Combos', 'puzzle', 'kits'],
  ['producao', 'Produção', 'factory', 'production'],
  ['embalagens', 'Embalagens', 'package', 'materials'],
  ['etiquetas', 'Etiquetas', 'tag', 'labels'],
  ['expedicao', 'Expedição', 'truck', 'expeditions'],
  ['produtividade', 'Produtividade', 'users', 'productivity'],
  ['inventario', 'Inventário', 'clipboard', 'inventory'],
  ['relatorios', 'Relatórios', 'chart', 'reports'],
  ['ia', 'Gestor IA', 'spark', 'ai'],
  ['configuracoes', 'Configurações', 'settings', 'settings'],
];

const ROUTES = [
  { path: 'login', public: true, render: renderLogin },
  { path: 'produtos/novo', perm: 'products', render: renderProductForm },
  { path: 'produtos/:id', perm: 'products', render: renderProductForm },
  { path: 'produtos', perm: 'products', render: renderProducts },
  { path: 'recebimento', perm: 'entries', render: renderInbound },
  { path: 'estoque', perm: 'stock', render: renderStock },
  { path: 'kits', perm: 'kits', render: renderKits },
  { path: 'producao', perm: 'production', render: renderProduction },
  { path: 'embalagens', perm: 'materials', render: renderMaterials },
  { path: 'etiquetas', perm: 'labels', render: renderLabels },
  { path: 'expedicao', perm: 'expeditions', render: renderExpedition },
  { path: 'produtividade', perm: 'productivity', render: renderProductivity },
  { path: 'inventario', perm: 'inventory', render: renderInventory },
  { path: 'relatorios', perm: 'reports', render: renderReports },
  { path: 'ia', perm: 'ai', render: renderAi },
  { path: 'configuracoes', perm: 'settings', render: renderSettings },
  { path: '', perm: 'dashboard', render: renderDashboard },
];

let session = null;
let sequence = 0;

function parseRoute() {
  const raw = location.hash.replace(/^#/, '');
  const [pathPart, queryPart] = (raw.startsWith('/') ? raw.slice(1) : raw).split('?');
  return { path: pathPart || '', query: Object.fromEntries(new URLSearchParams(queryPart || '')) };
}

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const expected = route.path.split('/').filter(Boolean);
    if (expected.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let index = 0; index < expected.length; index += 1) {
      if (expected[index].startsWith(':')) params[expected[index].slice(1)] = decodeURIComponent(parts[index]);
      else if (expected[index] !== parts[index]) ok = false;
    }
    if (ok) return { route, params };
  }
  return null;
}

function shell(user, path) {
  const items = MENU.filter((item) => can(user, item[3])).map(([href, label, glyph]) => {
    const active = path === href || (href && path.startsWith(`${href}/`));
    return `<a class="${active ? 'active' : ''}" href="#/${href}">${icon(glyph)}<span>${label}</span></a>`;
  }).join('');
  const dark = document.documentElement.classList.contains('dark');
  return `<div class="app">
    <button class="icon-btn menu-btn" id="menu" type="button" aria-label="Abrir menu">${icon('layers')}</button>
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-kicker">Sistema interno</div>
        <h1>Lúmina Ops</h1>
        <p>Estoque, kits e expedição</p>
      </div>
      <nav class="nav">${items}</nav>
      <div class="sidebar-foot">
        <div class="sidebar-user">${esc(user.name.split(' ')[0])} · ${esc(user.roleLabel)}</div>
        <button class="btn btn-ghost" id="theme" type="button">${dark ? 'Modo claro' : 'Modo escuro'}</button>
        <button class="btn btn-ghost" id="logout" type="button">Sair</button>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <section class="workspace">
      <header class="topbar">
        <div class="date" id="today-label"></div>
        <div class="spacer"></div>
        <button class="icon-btn" id="alerts" type="button" aria-label="Alertas">${icon('bell')}</button>
        <div class="who"><div class="avatar">${esc(user.name.slice(0, 1))}</div><span><b>${esc(user.name)}</b><small>${esc(user.roleLabel)}</small></span></div>
      </header>
      <div class="outlet" id="outlet"></div>
    </section>
  </div>`;
}

async function draw() {
  const token = ++sequence;
  const app = document.getElementById('app');
  const { path, query } = parseRoute();
  if (!getToken() || path === 'login') {
    session = null;
    if (path !== 'login') { location.hash = '#/login'; return; }
    const view = await renderLogin();
    if (token !== sequence) return;
    app.innerHTML = view.html;
    view.bind(app);
    return;
  }
  if (!session) {
    try { session = await api('/api/auth/me'); }
    catch { clearToken(); location.hash = '#/login'; return; }
  }
  const found = match(path);
  if (!found || (found.route.perm && !can(session.user, found.route.perm))) {
    const fallback = MENU.find((item) => can(session.user, item[3]));
    location.hash = `#/${fallback ? fallback[0] : 'login'}`;
    return;
  }
  app.innerHTML = shell(session.user, path);
  app.querySelector('#today-label').textContent = longDate(session.today);
  app.querySelector('#menu').onclick = () => {
    app.querySelector('#sidebar').classList.toggle('open');
    app.querySelector('#scrim').classList.toggle('show');
  };
  app.querySelector('#scrim').onclick = () => {
    app.querySelector('#sidebar').classList.remove('open');
    app.querySelector('#scrim').classList.remove('show');
  };
  app.querySelectorAll('#sidebar a').forEach((link) => {
    link.addEventListener('click', () => {
      app.querySelector('#sidebar').classList.remove('open');
      app.querySelector('#scrim').classList.remove('show');
    });
  });
  app.querySelector('#theme').onclick = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('lumina_theme', next ? 'dark' : 'light');
    app.querySelector('#theme').textContent = next ? 'Modo claro' : 'Modo escuro';
  };
  app.querySelector('#logout').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    clearToken();
    session = null;
    location.hash = '#/login';
  };
  app.querySelector('#alerts').onclick = () => showAlerts();
  const outlet = app.querySelector('#outlet');
  const ctx = { user: session.user, params: found.params, query, reload: draw, today: session.today, company: session.company, operation: session.operation };
  try {
    const view = await found.route.render(ctx);
    if (token !== sequence) return;
    outlet.innerHTML = view.html;
    view.bind?.(outlet, ctx);
  } catch (error) {
    if (token !== sequence) return;
    outlet.innerHTML = `<div class="banner banner-danger">${esc(error.message || 'Não foi possível abrir esta tela.')}</div>`;
  }
}

async function showAlerts() {
  const { modal, esc, pill } = await import('./ui.js');
  const alerts = await api('/api/alerts').catch(() => []);
  const body = alerts.length ? alerts.map((alert) => `<div class="item"><div><b>${esc(alert.title)}</b><div class="muted">${esc(alert.message)}</div></div>${pill(alert.level === 'danger' ? 'danger' : 'warn', alert.level === 'danger' ? 'Crítico' : 'Atenção')}</div>`).join('') : '<p class="empty">Nenhum alerta aberto.</p>';
  const box = modal({ title: 'Alertas da operação', body: `<div class="list">${body}</div>` });
  box.root.querySelectorAll('.item').forEach((item, index) => {
    const alert = alerts[index];
    if (!alert) return;
    item.style.cursor = 'pointer';
    item.onclick = async () => {
      if (alert.id) await api(`/api/alerts/${alert.id}/resolve`, { method: 'POST', body: {} }).catch(() => {});
      box.close();
      if (alert.href) location.hash = alert.href;
    };
  });
}

window.addEventListener('hashchange', draw);
if (!location.hash) location.hash = '#/';
draw();
