import { api, can, detailText } from '../api.js';
import { donut, groupedBars, hbars } from '../charts.js';
import { banner, dateBR, esc, field, pageHead, pill, qty, toast, TYPE_LABEL } from '../ui.js';

export async function renderStock(ctx) {
  const tab = ctx.query.aba || 'saldos';
  const [products, materials, lots, movements, analysis] = await Promise.all([
    api('/api/products'), api('/api/materials'), api('/api/lots?onlyPositive=1'), api('/api/movements'), api('/api/dashboard/stock'),
  ]);
  const tabs = ['saldos', 'lotes', 'movimentos', 'analise', 'abc'].map((item) => `<button class="btn btn-sm ${tab === item ? 'active' : ''}" data-tab="${item}" type="button">${ { saldos: 'Saldos', lotes: 'Lotes', movimentos: 'Movimentações', analise: 'Gráficos', abc: 'Curva ABC' }[item] }</button>`).join('');
  let body = '';
  if (tab === 'saldos') {
    const rows = [
      ...products.map((item) => ({ ...item, kind: 'Produto' })),
      ...materials.map((item) => ({ ...item, kind: 'Embalagem', sku: item.code })),
    ];
    body = `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Tipo</th><th class="num">Saldo</th><th class="num">Mínimo</th><th>Local</th><th></th></tr></thead><tbody>
      ${rows.map((item) => `<tr><td><b>${esc(item.name)}</b><div class="muted">${esc(item.sku || '')}</div></td><td>${esc(item.kind)}</td><td class="num ${item.minStock > 0 && item.stockQty <= item.minStock ? 'down' : ''}">${qty(item.stockQty)} ${esc(item.unit)}</td><td class="num">${qty(item.minStock)}</td><td>${esc(item.location || '—')}</td><td>${item.minStock > 0 && item.stockQty <= item.minStock ? pill('danger', 'Crítico') : item.minStock > 0 && item.stockQty <= item.minStock * 1.25 ? pill('warn', 'Atenção') : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  } else if (tab === 'lotes') {
    body = `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Lote</th><th class="num">Quantidade</th><th>Validade</th><th>Recebido</th><th>Local</th></tr></thead><tbody>
      ${lots.map((lot) => `<tr><td>${esc(lot.itemName)}</td><td>${esc(lot.lotCode)}</td><td class="num">${qty(lot.quantity)} ${esc(lot.unit)}</td><td>${dateBR(lot.expiryDate)}</td><td>${dateBR(lot.receivedAt)}</td><td>${esc(lot.location || '—')}</td></tr>`).join('')}
    </tbody></table></div>`;
  } else if (tab === 'movimentos') {
    body = `<form class="filters" id="mov-filters">
        ${field('De', `<input type="date" name="from">`)}
        ${field('Até', `<input type="date" name="to" value="${ctx.today}">`)}
        ${field('Tipo', `<select name="type"><option value="">Todos</option>${['entrada','producao','montagem','expedicao','inventario','transferencia','estorno'].map((item) => `<option value="${item}">${TYPE_LABEL[item]}</option>`).join('')}</select>`)}
        ${field('Busca', '<input name="q" placeholder="Produto, OP, nota">', 'grow')}
      </form>
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Quando</th><th>Tipo</th><th>Item</th><th class="num">Qtd</th><th class="num">Saldo</th><th>Lote</th><th>Origem</th><th>Referência</th><th>Usuário</th></tr></thead><tbody id="mov-body">
        ${movementRows(movements)}
      </tbody></table></div>
      ${can(ctx.user, 'transfers', true) ? `<form class="card" id="transfer" style="margin-top:14px"><h2>Transferência de localização</h2><p class="help">O saldo total não muda. O histórico registra origem e destino.</p><div class="form-grid">
        ${field('Item', `<select name="item">${products.map((item) => `<option value="product:${item.id}">${esc(item.name)}</option>`).join('')}${materials.map((item) => `<option value="material:${item.id}">${esc(item.name)}</option>`).join('')}</select>`, 'wide')}
        ${field('Quantidade', '<input name="quantity" type="number" min="0.01" step="0.01" value="1">')}
        ${field('De', '<input name="fromLocation" required>')}
        ${field('Para', '<input name="toLocation" required>')}
        ${field('Lote', '<input name="lotCode">')}
      </div><button class="btn btn-primary" type="submit">Registrar transferência</button><div id="transfer-error"></div></form>` : ''}`;
  } else if (tab === 'analise') {
    body = `<div class="grid-2"><article class="card"><h2>Entradas x saídas</h2>${groupedBars(analysis.inOut)}</article><article class="card"><h2>Estoque por categoria</h2>${donut(analysis.categories)}</article></div>
      <div class="grid-2"><article class="card"><h2>Maior giro</h2>${hbars(analysis.giroTop)}</article><article class="card"><h2>Menor giro</h2>${hbars(analysis.giroLow, '#1e4f86')}</article></div>
      <article class="card"><h2>Estoque parado</h2>${analysis.idle.length ? analysis.idle.map((item) => `<div class="item"><span>${esc(item.name)}</span><b>${qty(item.stockQty)} sem expedição em 30 dias</b></div>`).join('') : '<p class="empty">Nenhum produto com saldo ficou sem expedição no período.</p>'}</article>`;
  } else {
    body = `<article class="card"><div class="card-head"><h2>Curva ABC</h2><p>Classificação pelo valor expedido nos últimos 30 dias.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Valor</th><th>Classe</th></tr></thead><tbody>
        ${analysis.abc.map((item) => `<tr><td>${esc(item.name)}</td><td class="num">${qty(item.qty)}</td><td class="num">${qty(item.value)}</td><td>${pill(item.klass === 'A' ? 'danger' : item.klass === 'B' ? 'warn' : 'info', item.klass)}</td></tr>`).join('')}
      </tbody></table></div></article>`;
  }
  return {
    html: `${pageHead({ kicker: 'Controle', title: 'Estoque', text: 'Saldos, lotes, livro de movimentações e a curva ABC. Movimentação confirmada não se apaga: o caminho é o estorno.' })}<div class="tabs">${tabs}</div>${body}`,
    bind(root) {
      root.querySelectorAll('[data-tab]').forEach((button) => { button.onclick = () => { location.hash = `#/estoque?aba=${button.dataset.tab}`; }; });
      const form = root.querySelector('#mov-filters');
      if (form) {
        form.onchange = async () => {
          const query = new URLSearchParams(new FormData(form));
          const rows = await api(`/api/movements?${query.toString()}`);
          root.querySelector('#mov-body').innerHTML = movementRows(rows);
        };
      }
      const transfer = root.querySelector('#transfer');
      if (transfer) transfer.onsubmit = async (event) => {
        event.preventDefault();
        const [itemType, itemId] = transfer.item.value.split(':');
        try {
          await api('/api/transfers', { method: 'POST', body: { itemType, itemId, quantity: transfer.quantity.value, fromLocation: transfer.fromLocation.value, toLocation: transfer.toLocation.value, lotCode: transfer.lotCode.value } });
          toast('Transferência registrada.');
          ctx.reload();
        } catch (error) {
          root.querySelector('#transfer-error').innerHTML = banner('danger', detailText(error));
        }
      };
    },
  };
}

function movementRows(rows) {
  return rows.map((item) => `<tr><td>${dateBR(item.date)} ${esc((item.time || '').slice(0, 5))}</td><td>${esc(TYPE_LABEL[item.type] || item.type)}</td><td>${esc(item.itemName)}</td><td class="num ${item.quantity < 0 ? 'down' : 'up'}">${item.quantity > 0 ? '+' : ''}${qty(item.quantity)}</td><td class="num">${qty(item.balanceAfter)}</td><td>${esc(item.lotCode || '—')}</td><td>${esc(item.origin || '')}</td><td>${esc(item.reference || item.notes || '')}</td><td>${esc(item.userName || '')}</td></tr>`).join('');
}
