import { api, can, detailText } from '../api.js';
import { banner, dateBR, esc, field, impacts, pageHead, qty, toast } from '../ui.js';

export async function renderInbound(ctx) {
  const [products, materials, suppliers, entries] = await Promise.all([
    api('/api/products'), api('/api/materials'), api('/api/suppliers'), api('/api/entries'),
  ]);
  const writable = can(ctx.user, 'entries', true);
  return {
    html: `${pageHead({ kicker: 'Recebimento', title: 'Entrada de estoque', text: 'Ao confirmar, o saldo sobe e o lote fica rastreável. Nada é lançado peça por peça depois.' })}
      <form class="card" id="entry-form">
        <div id="entry-error"></div>
        <div class="form-grid">
          ${field('Data', `<input type="date" name="date" required value="${ctx.today}">`)}
          ${field('Fornecedor', `<select name="supplierId"><option value="">—</option>${suppliers.filter((item) => item.active).map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select>`)}
          ${field('Nota fiscal', '<input name="invoice" placeholder="NF-00000">')}
          ${field('Observação', '<input name="notes">', 'wide')}
        </div>
        <div id="lines"></div>
        ${writable ? '<div class="page-actions" style="margin-top:12px"><button class="btn" type="button" id="add-line">Adicionar item</button><button class="btn btn-primary" type="submit">Confirmar entrada</button></div>' : ''}
        <div id="entry-result"></div>
      </form>
      <article class="card"><div class="card-head"><h2>Entradas recentes</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Data</th><th>Nota</th><th>Fornecedor</th><th>Itens</th><th>Status</th></tr></thead>
        <tbody>${entries.slice(0, 12).map((entry) => `<tr><td>${dateBR(entry.date)}</td><td>${esc(entry.invoice || '—')}</td><td>${esc(entry.supplierName || '—')}</td><td>${entry.items.map((item) => `${esc(item.itemName)} (${qty(item.quantity)})`).join(', ')}</td><td>${esc(entry.status)}</td></tr>`).join('')}</tbody></table></div>
      </article>`,
    bind(root) {
      const lines = [{ itemType: 'product', itemId: '', quantity: 1, lotCode: '', expiryDate: '', location: '' }];
      const paint = () => {
        for (const line of lines) {
          if (!line.itemId) {
            const list = line.itemType === 'material' ? materials : products;
            line.itemId = list[0]?.id || '';
          }
        }
        root.querySelector('#lines').innerHTML = lines.map((line, index) => `<div class="form-grid" style="margin-top:10px">
          ${field('Tipo', `<select data-k="itemType" data-i="${index}"><option value="product" ${line.itemType === 'product' ? 'selected' : ''}>Produto</option><option value="material" ${line.itemType === 'material' ? 'selected' : ''}>Embalagem</option></select>`)}
          ${field('Item', `<select data-k="itemId" data-i="${index}">${(line.itemType === 'material' ? materials : products).map((item) => `<option value="${item.id}" ${String(item.id) === String(line.itemId) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`, 'wide')}
          ${field('Quantidade', `<input data-k="quantity" data-i="${index}" type="number" min="0.01" step="0.01" value="${line.quantity}">`)}
          ${field('Lote', `<input data-k="lotCode" data-i="${index}" value="${esc(line.lotCode)}">`)}
          ${field('Validade', `<input data-k="expiryDate" data-i="${index}" type="date" value="${esc(line.expiryDate)}">`)}
          ${field('Localização', `<input data-k="location" data-i="${index}" value="${esc(line.location)}">`)}
          <button class="btn btn-sm" type="button" data-del="${index}">Remover</button>
        </div>`).join('');
        root.querySelectorAll('[data-k]').forEach((input) => {
          input.onchange = () => {
            lines[input.dataset.i][input.dataset.k] = input.value;
            if (input.dataset.k === 'itemType') paint();
          };
        });
        root.querySelectorAll('[data-del]').forEach((button) => { button.onclick = () => { lines.splice(Number(button.dataset.del), 1); paint(); }; });
      };
      paint();
      root.querySelector('#add-line')?.addEventListener('click', () => { lines.push({ itemType: 'product', itemId: products[0]?.id || '', quantity: 1, lotCode: '', expiryDate: '', location: '' }); paint(); });
      root.querySelector('#entry-form').onsubmit = async (event) => {
        event.preventDefault();
        const form = event.target;
        try {
          const result = await api('/api/entries', { method: 'POST', body: { date: form.date.value, supplierId: form.supplierId.value || null, invoice: form.invoice.value, notes: form.notes.value, items: lines } });
          root.querySelector('#entry-result').innerHTML = `${banner('ok', 'Entrada confirmada. O estoque e o histórico foram atualizados.')}${impacts(result.impacts)}`;
          toast('Recebimento lançado.');
        } catch (error) {
          root.querySelector('#entry-error').innerHTML = banner('danger', detailText(error));
        }
      };
    },
  };
}
