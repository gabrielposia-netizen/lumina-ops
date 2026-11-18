import { api, can, detailText } from '../api.js';
import { banner, dateBR, esc, pageHead, qty, toast } from '../ui.js';

export async function renderInventory(ctx) {
  const [sheet, history] = await Promise.all([api('/api/inventory/sheet'), api('/api/inventory')]);
  const writable = can(ctx.user, 'inventory', true);
  return {
    html: `${pageHead({ kicker: 'Contagem', title: 'Inventário', text: 'Compare o saldo do sistema com a contagem física. Diferença exige justificativa e vira ajuste, sem apagar o histórico.' })}
      ${writable ? `<form class="card" id="count-form"><div id="count-error"></div>
        <label class="field"><span>Observação da contagem</span><input name="notes" placeholder="Contagem cíclica da área A"></label>
        <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th></th><th>Item</th><th class="num">Sistema</th><th class="num">Físico</th><th>Justificativa</th></tr></thead><tbody>
          ${sheet.map((item) => `<tr><td><input type="checkbox" data-check="${item.itemType}:${item.id}"></td><td>${esc(item.name)}<div class="muted">${esc(item.code || item.type || '')}</div></td><td class="num">${qty(item.stockQty)}</td><td><input data-physical="${item.itemType}:${item.id}" type="number" min="0" step="0.01" value="${item.stockQty}" style="max-width:120px"></td><td><input data-why="${item.itemType}:${item.id}" placeholder="Obrigatória se houver diferença"></td></tr>`).join('')}
        </tbody></table></div>
        <button class="btn btn-primary" style="margin-top:12px" type="submit">Aplicar ajustes</button></form>` : ''}
      <article class="card"><div class="card-head"><h2>Contagens anteriores</h2></div><div class="list">${history.map((item) => `<a href="#" data-open="${item.id}">${dateBR(item.date)} · ${esc(item.userName)} · ${item.divergences} divergência(s)</a>`).join('') || '<p class="empty">Nenhuma contagem ainda.</p>'}</div><div id="count-detail"></div></article>`,
    bind(root) {
      root.querySelector('#count-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const counts = [...root.querySelectorAll('[data-check]:checked')].map((box) => {
          const [itemType, itemId] = box.dataset.check.split(':');
          return { itemType, itemId, physicalQty: root.querySelector(`[data-physical="${box.dataset.check}"]`).value, justification: root.querySelector(`[data-why="${box.dataset.check}"]`).value };
        });
        try {
          const result = await api('/api/inventory', { method: 'POST', body: { notes: event.target.notes.value, counts } });
          toast(result.impacts?.length ? 'Ajustes lançados no estoque.' : 'Contagem registrada, sem diferença.');
          ctx.reload();
        } catch (error) {
          root.querySelector('#count-error').innerHTML = banner('danger', detailText(error));
        }
      });
      root.querySelectorAll('[data-open]').forEach((link) => {
        link.onclick = async (event) => {
          event.preventDefault();
          const inventory = await api(`/api/inventory/${link.dataset.open}`);
          root.querySelector('#count-detail').innerHTML = `<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Item</th><th class="num">Sistema</th><th class="num">Físico</th><th class="num">Diferença</th><th>Justificativa</th></tr></thead><tbody>
            ${inventory.counts.map((count) => `<tr><td>${esc(count.itemName)}</td><td class="num">${qty(count.systemQty)}</td><td class="num">${qty(count.physicalQty)}</td><td class="num ${count.difference < 0 ? 'down' : ''}">${qty(count.difference)}</td><td>${esc(count.justification || '')}</td></tr>`).join('')}
          </tbody></table></div>`;
        };
      });
    },
  };
}
