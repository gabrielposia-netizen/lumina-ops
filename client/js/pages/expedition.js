import { api, can, detailText } from '../api.js';
import { banner, dateBR, esc, field, impacts, pageHead, qty, toast } from '../ui.js';

export async function renderExpedition(ctx) {
  const [products, rows] = await Promise.all([api('/api/products'), api('/api/expeditions')]);
  const writable = can(ctx.user, 'expeditions', true);
  const active = products.filter((item) => item.status === 'ativo');
  return {
    html: `${pageHead({ kicker: 'Saída', title: 'Expedição', text: 'Kit já montado baixa 1 kit. Combo comercial baixa os componentes. O unitário baixa a própria unidade.' })}
      ${writable ? `<form class="card" id="ship-form"><div id="ship-error"></div><div class="form-grid">
        ${field('Produto', `<select name="productId">${active.map((item) => `<option value="${item.id}">${esc(item.name)} · ${qty(item.stockQty)} ${esc(item.unit)}</option>`).join('')}</select>`, 'wide')}
        ${field('Quantidade', '<input name="quantity" type="number" min="0.01" step="0.01" value="1" required>')}
        ${field('Lote', '<input name="lotCode" placeholder="Opcional, senão sai o mais antigo">')}
        ${field('Canal', '<select name="channel"><option>Site</option><option>Mercado Livre</option><option>Shopee</option><option>Amazon</option><option>Manual</option></select>')}
        ${field('Pedido', '<input name="orderRef" placeholder="PED-0000">')}
        ${field('Data', `<input type="date" name="date" value="${ctx.today}">`)}
        ${field('Código de barras', '<input id="scan" placeholder="Bipe para localizar o SKU">', 'wide')}
      </div><button class="btn btn-primary" type="submit">Confirmar expedição</button><div id="ship-result"></div></form>` : ''}
      <article class="card"><div class="card-head"><h2>Expedições</h2></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Produto</th><th class="num">Qtd</th><th>Canal</th><th>Pedido</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.slice(0, 40).map((item) => `<tr><td>${dateBR(item.date)}</td><td>${esc(item.productName)}</td><td class="num">${qty(item.quantity)}</td><td>${esc(item.channel || '')}</td><td>${esc(item.orderRef || '')}</td><td>${esc(item.status)}</td><td>${item.status === 'confirmada' && writable ? `<button class="btn btn-sm" data-reverse="${item.id}" type="button">Estornar</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></article>`,
    bind(root) {
      const form = root.querySelector('#ship-form');
      const scan = root.querySelector('#scan');
      if (scan) scan.onkeydown = async (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const found = await api(`/api/products/lookup?code=${encodeURIComponent(scan.value)}`);
        if (!found) { toast('Produto sem cadastro para esse código.', 'danger'); return; }
        form.productId.value = found.id;
        toast(`${found.name} localizado.`);
      };
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(form).entries());
        try {
          const result = await api('/api/expeditions', { method: 'POST', body });
          root.querySelector('#ship-result').innerHTML = `${banner('ok', 'Expedição confirmada. A baixa seguiu a regra do tipo de produto.')}${impacts(result.impacts)}`;
          toast('Expedição registrada.');
        } catch (error) {
          root.querySelector('#ship-error').innerHTML = banner('danger', detailText(error));
        }
      });
      root.querySelectorAll('[data-reverse]').forEach((button) => {
        button.onclick = async () => {
          const reason = prompt('Motivo do estorno');
          if (!reason) return;
          try {
            await api(`/api/expeditions/${button.dataset.reverse}/reverse`, { method: 'POST', body: { reason } });
            toast('Expedição estornada.');
            ctx.reload();
          } catch (error) { toast(error.message, 'danger'); }
        };
      });
    },
  };
}
