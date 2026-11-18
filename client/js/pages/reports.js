import { api, getToken } from '../api.js';
import { dateBR, esc, pageHead, qty } from '../ui.js';

const REPORTS = [
  ['estoque', 'Estoque'], ['entradas', 'Entradas'], ['saidas', 'Saídas'], ['producao', 'Produção'],
  ['produtividade', 'Produtividade'], ['kits', 'Kits'], ['componentes', 'Componentes'], ['embalagens', 'Embalagens'],
  ['etiquetas', 'Etiquetas'], ['expedicao', 'Expedição'], ['inventario', 'Inventário'], ['divergencias', 'Divergências'], ['consumo', 'Consumo'],
];

export async function renderReports(ctx) {
  const type = ctx.query.tipo || 'estoque';
  const from = ctx.query.de || `${ctx.today.slice(0, 7)}-01`;
  const to = ctx.query.ate || ctx.today;
  const report = await api(`/api/reports/${type}?from=${from}&to=${to}`);
  return {
    html: `${pageHead({ kicker: 'Gestão', title: 'Relatórios', text: 'Os mesmos números do estoque, prontos para Excel, CSV ou PDF.' })}
      <div class="tabs">${REPORTS.map(([id, label]) => `<button class="btn btn-sm ${id === type ? 'active' : ''}" data-type="${id}" type="button">${label}</button>`).join('')}</div>
      <form class="filters" id="range">
        <label class="field"><span>De</span><input type="date" name="from" value="${from}"></label>
        <label class="field"><span>Até</span><input type="date" name="to" value="${to}"></label>
        <button class="btn" type="submit">Atualizar</button>
        <button class="btn" type="button" id="csv">Excel CSV</button>
        <button class="btn" type="button" id="xls">Excel</button>
        <button class="btn" type="button" id="pdf">PDF</button>
      </form>
      <article class="card" id="print-area"><div class="card-head"><div><h2>${esc(report.title)}</h2><p>${dateBR(from)} a ${dateBR(to)} · Lúmina Hair</p></div></div>
        <div class="table-wrap"><table><thead><tr>${report.columns.map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr></thead><tbody>
          ${report.rows.slice(0, 300).map((row) => `<tr>${report.columns.map((column) => `<td>${format(row[column.key])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${report.columns.length}">Sem registros no período.</td></tr>`}
        </tbody></table></div>
        ${report.rows.length > 300 ? '<p class="help">A tela mostra 300 linhas. A exportação traz o relatório completo.</p>' : ''}
      </article>`,
    bind(root) {
      const go = (extra = {}) => {
        const form = root.querySelector('#range');
        const params = new URLSearchParams({ tipo: extra.tipo || type, de: form.from.value, ate: form.to.value });
        location.hash = `#/relatorios?${params.toString()}`;
      };
      root.querySelectorAll('[data-type]').forEach((button) => { button.onclick = () => go({ tipo: button.dataset.type }); });
      root.querySelector('#range').onsubmit = (event) => { event.preventDefault(); go(); };
      const download = async (format) => {
        const response = await fetch(`/api/reports/${type}?from=${from}&to=${to}&format=${format}`, { headers: { Authorization: `Bearer ${getToken()}` } });
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${type}.${format === 'xls' ? 'xls' : 'csv'}`;
        link.click();
        URL.revokeObjectURL(url);
      };
      root.querySelector('#csv').onclick = () => download('csv');
      root.querySelector('#xls').onclick = () => download('xls');
      root.querySelector('#pdf').onclick = () => window.print();
    },
  };
}

function format(value) {
  if (typeof value === 'number') return qty(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return dateBR(value);
  return esc(value ?? '');
}
