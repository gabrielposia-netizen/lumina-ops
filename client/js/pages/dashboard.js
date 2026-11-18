import { api } from '../api.js';
import { donut, groupedBars, hbars, lineChart } from '../charts.js';
import { dateBR, esc, money, pageHead, pct, pill, qty } from '../ui.js';

export async function renderDashboard(ctx) {
  const data = await api('/api/dashboard/overview');
  const stock = await api('/api/dashboard/stock').catch(() => null);
  const k = data.kpis;
  const card = (label, value, foot, kind = '') => `<article class="kpi ${kind}"><span>${esc(label)}</span><strong>${value}</strong><em>${foot}</em></article>`;
  return {
    html: `${pageHead({ kicker: 'Visão da operação', title: 'Dashboard', text: 'O que chegou, o que foi montado e o que saiu hoje — com o impacto já refletido no estoque.' })}
      <section class="kpi-grid">
        ${card('Estoque total', qty(k.stockUnits), k.stockValue != null ? money(k.stockValue) : 'unidades em saldo')}
        ${card('Produtos cadastrados', qty(k.products), 'ativos no cadastro')}
        ${card('Kits em estoque', qty(k.kitsStock), 'produtos acabados')}
        ${card('Recebidos hoje', qty(k.receivedToday), 'unidades de produto')}
        ${card('Produção de hoje', qty(k.productionToday), `meta ${qty(k.goalToday)}`)}
        ${card('Expedições de hoje', qty(k.expeditionsToday), 'unidades expedidas')}
        ${card('Estoques críticos', qty(k.criticalCount), 'no mínimo ou abaixo', k.criticalCount ? 'danger' : '')}
        ${card('Produtividade média', pct(k.efficiency), 'realizado sobre a meta do dia', k.efficiency != null && k.efficiency < 1 ? 'warn' : '')}
        ${card('Caixas disponíveis', qty(k.boxes), (k.boxLines || []).map((item) => `${item.name}: ${qty(item.stock)}`).join(' · ') || 'sem caixas')}
        ${card('Materiais de embalagem', qty(k.materials), `${k.materialsCritical} em atenção`, k.materialsCritical ? 'warn' : '')}
      </section>
      ${data.insight ? `<section class="insight"><div class="mark">IA</div><div><b>Gestor IA</b><p>${esc(data.insight.text)}</p></div><a class="btn" href="#/ia">Perguntar</a></section>` : ''}
      <section class="flow">${data.flow.map((step) => `<div><span>${esc(step.label)}</span><strong>${qty(step.value)}</strong></div>`).join('')}</section>
      <div class="grid-2">
        <article class="card"><div class="card-head"><h2>Produção · 15 dias</h2></div>${lineChart(data.productionSeries)}</article>
        <article class="card"><div class="card-head"><h2>Ranking de hoje</h2></div>${hbars(data.ranking.map((item) => ({ name: item.name, qty: item.qty })))}</article>
      </div>
      <div class="grid-2">
        <article class="card"><div class="card-head"><h2>Entradas e saídas</h2><div class="legend"><span><i style="background:#2e7d32"></i>Entrada</span><span><i style="background:#ec1f28"></i>Expedição</span></div></div>${groupedBars(data.inOut)}</article>
        <article class="card"><div class="card-head"><h2>Estoque por categoria</h2></div>${stock ? donut(stock.categories) : ''}</article>
      </div>
      <div class="grid-2">
        <article class="card"><div class="card-head"><h2>Atenção imediata</h2><a href="#/estoque">Ver estoque</a></div><div class="list">${data.critical.length ? data.critical.map((item) => `<div class="item"><span>${esc(item.name)}</span><b class="down">${qty(item.stock)} / mín. ${qty(item.min)}</b></div>`).join('') : '<p class="empty">Nenhum item abaixo do mínimo.</p>'}</div></article>
        <article class="card"><div class="card-head"><h2>Últimas movimentações</h2><a href="#/estoque?aba=movimentos">Histórico</a></div><div class="list">${data.movements.map((item) => `<div class="item"><div><b>${esc(item.itemName)}</b><div class="muted">${dateBR(item.date)} ${esc(item.time?.slice(0, 5) || '')} · ${esc(item.userName || '')}</div></div><span class="${item.quantity < 0 ? 'down' : 'up'}">${item.quantity > 0 ? '+' : ''}${qty(item.quantity)}</span></div>`).join('')}</div></article>
      </div>
      <article class="card"><div class="card-head"><h2>Alertas</h2></div><div class="list">${data.alerts.length ? data.alerts.map((alert) => `<a href="${esc(alert.href || '#/')}">${pill(alert.level === 'danger' ? 'danger' : 'warn', alert.title)}<span>${esc(alert.message)}</span></a>`).join('') : '<p class="empty">Operação sem alertas críticos.</p>'}</div></article>`,
  };
}
