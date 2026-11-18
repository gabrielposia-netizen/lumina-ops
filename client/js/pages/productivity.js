import { api } from '../api.js';
import { hbars, lineChart } from '../charts.js';
import { esc, pageHead, pct, qty } from '../ui.js';

export async function renderProductivity(ctx) {
  const range = ctx.query.periodo || 'hoje';
  const end = ctx.today;
  const start = range === 'semana' ? shift(end, -6) : range === 'mes' ? `${end.slice(0, 7)}-01` : range === 'ontem' ? shift(end, -1) : end;
  const to = range === 'ontem' ? start : end;
  const data = await api(`/api/productivity?from=${start}&to=${to}`);
  return {
    html: `${pageHead({ kicker: 'Pessoas e turnos', title: 'Produtividade', text: 'Produção por colaborador, hora, turno e a distância entre a meta e o realizado.' })}
      <div class="tabs">${[['hoje', 'Hoje'], ['ontem', 'Ontem'], ['semana', '7 dias'], ['mes', 'Mês']].map(([id, label]) => `<button class="btn btn-sm ${range === id ? 'active' : ''}" data-range="${id}" type="button">${label}</button>`).join('')}</div>
      <section class="kpi-grid">
        <article class="kpi"><span>Produzido</span><strong>${qty(data.total)}</strong><em>kits no período</em></article>
        <article class="kpi"><span>Média por pessoa</span><strong>${qty(data.average)}</strong></article>
        <article class="kpi"><span>Quem lidera</span><strong style="font-size:22px">${esc(data.ranking[0]?.name || '—')}</strong><em>${qty(data.ranking[0]?.qty || 0)} kits</em></article>
      </section>
      <div class="grid-2">
        <article class="card"><div class="card-head"><h2>Ranking</h2></div>${hbars(data.ranking)}</article>
        <article class="card"><div class="card-head"><h2>Por turno</h2></div>${data.byShift.map((shiftRow) => `<div class="rank"><div><b>${esc(shiftRow.name)}</b><div class="muted">${qty(shiftRow.qty)} · meta ${qty(shiftRow.target)} · ${pct(shiftRow.efficiency)}</div></div></div>`).join('') || '<p class="empty">Sem turno no período.</p>'}</article>
      </div>
      <article class="card"><div class="card-head"><h2>Evolução</h2></div>${lineChart(data.byDay)}</article>
      <div class="table-wrap"><table><thead><tr><th>Colaborador</th><th class="num">Produção</th><th class="num">Meta</th><th class="num">Eficiência</th><th class="num">Por hora</th><th class="num">Dias</th></tr></thead><tbody>
        ${data.ranking.map((item) => `<tr><td>${esc(item.name)}</td><td class="num">${qty(item.qty)}</td><td class="num">${qty(item.goal)}</td><td class="num">${pct(item.efficiency)}</td><td class="num">${item.perHour == null ? '—' : qty(item.perHour)}</td><td class="num">${item.days}</td></tr>`).join('')}
      </tbody></table></div>`,
    bind(root) {
      root.querySelectorAll('[data-range]').forEach((button) => {
        button.onclick = () => { location.hash = `#/produtividade?periodo=${button.dataset.range}`; };
      });
    },
  };
}

function shift(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}
