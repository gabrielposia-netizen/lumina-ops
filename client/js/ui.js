export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function qty(value) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Math.round(Number(value) * 100).toLocaleString('pt-BR')}%`;
}

export function dateBR(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function longDate(value) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export const TYPE_LABEL = {
  unitario: 'Unitário', kit: 'Kit', combo: 'Combo',
  entrada: 'Entrada', saida: 'Saída', producao: 'Produção', montagem: 'Montagem',
  expedicao: 'Expedição', ajuste: 'Ajuste', inventario: 'Inventário', transferencia: 'Transferência', estorno: 'Estorno',
  fisico: 'Montado', comercial: 'Comercial',
};

export function pill(kind, text) {
  return `<span class="pill pill-${kind}">${esc(text)}</span>`;
}

export function statusPill(status) {
  const map = { ativo: 'ok', confirmada: 'ok', pronto: 'ok', ok: 'ok', atencao: 'warn', pendente: 'warn', inativo: 'neutral', bloqueado: 'danger', rejeitada: 'danger', duplicada: 'warn', estornada: 'info', critico: 'danger' };
  return pill(map[status] || 'info', TYPE_LABEL[status] || status);
}

const ICONS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6.5 10.5V20h11V10.5"/>',
  box: '<path d="M3 8l9-4 9 4-9 4-9-4Z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>',
  inbox: '<path d="M3 13h5l1.5 2h5L16 13h5"/><path d="M4 6h16v12H4z"/>',
  layers: '<path d="m4 9 8-4 8 4-8 4-8-4Z"/><path d="m4 14 8 4 8-4"/>',
  puzzle: '<path d="M8 4h4a2 2 0 1 1 0 4h1v3h3a2 2 0 1 1 0 4h-3v3H8v-3H5V8h3V4Z"/>',
  factory: '<path d="M3 20V10l6 3V10l6 3V8l6 3v9H3Z"/>',
  package: '<path d="M4 8h16v11H4z"/><path d="M4 8l8-4 8 4M12 4v15"/>',
  tag: '<path d="M4 12V5h7l9 9-7 7-9-9Z"/><path d="M8 8h.01"/>',
  truck: '<path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/>',
  users: '<path d="M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M3 19c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/><path d="M16 11a2.5 2.5 0 1 0 0-5"/><path d="M16.5 15c2 .3 3.5 1.5 4.2 4"/>',
  clipboard: '<path d="M8 5h8v3H8z"/><path d="M7 7H5v13h14V7h-2"/>',
  chart: '<path d="M4 19h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
  spark: '<path d="M12 3v4M12 17v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M3 12h4M17 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

export function pageHead({ kicker, title, text, actions = '' }) {
  return `<header class="page-head"><div>${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h1>${esc(title)}</h1>${text ? `<p class="lede">${esc(text)}</p>` : ''}</div><div class="page-actions">${actions}</div></header>`;
}

export function field(label, control, extra = '') {
  return `<label class="field ${extra}"><span>${esc(label)}</span>${control}</label>`;
}

export function toast(message, kind = 'ok') {
  let wrap = document.querySelector('.toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toasts';
    document.body.appendChild(wrap);
  }
  const item = document.createElement('div');
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  wrap.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

export function modal({ title, body, footer = '' }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog"><header><h2>${esc(title)}</h2><button class="icon-btn" data-close type="button">×</button></header><div class="modal-body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  const close = () => back.remove();
  back.addEventListener('click', (event) => {
    if (event.target === back || event.target.closest('[data-close]')) close();
  });
  document.body.appendChild(back);
  return { root: back, close };
}

export function confirmDialog({ title, text, confirm = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const box = modal({
      title,
      body: `<p>${esc(text)}</p>`,
      footer: `<button class="btn" type="button" data-no>Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-yes>${esc(confirm)}</button>`,
    });
    box.root.querySelector('[data-no]').onclick = () => { box.close(); resolve(false); };
    box.root.querySelector('[data-yes]').onclick = () => { box.close(); resolve(true); };
  });
}

export function impacts(list = []) {
  if (!list.length) return '';
  return `<div class="impact">${list.map((item) => `<div><span class="${item.quantity < 0 ? 'down' : 'up'}">${item.quantity > 0 ? '+' : ''}${qty(item.quantity)}</span><strong>${esc(item.itemName)}</strong><em class="muted">${esc(TYPE_LABEL[item.type] || item.type)}${item.lotCode ? ` · lote ${esc(item.lotCode)}` : ''}</em></div>`).join('')}</div>`;
}

export function banner(kind, text) {
  return `<div class="banner banner-${kind}">${esc(text)}</div>`;
}

export async function readFile(file) {
  const data = await file.arrayBuffer();
  const bytes = new Uint8Array(data);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return { filename: file.name, mime: file.type, contentBase64: btoa(binary), base64: btoa(binary) };
}

export function options(items, value, label, placeholder = 'Selecione') {
  return `<option value="">${esc(placeholder)}</option>${items.map((item) => `<option value="${esc(item[value])}">${esc(item[label])}</option>`).join('')}`;
}

export function bindFilters(root, onChange) {
  root.querySelectorAll('[data-filter]').forEach((input) => input.addEventListener('change', onChange));
  const search = root.querySelector('[data-search]');
  if (search) search.addEventListener('input', onChange);
}
