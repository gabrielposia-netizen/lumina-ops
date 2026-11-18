import { api, can, detailText } from '../api.js';
import { banner, esc, field, pageHead, pill, qty, readFile, statusPill, toast, TYPE_LABEL } from '../ui.js';

export async function renderProducts(ctx) {
  const [products, categories] = await Promise.all([
    api(`/api/products${location.search || ''}`),
    api('/api/categories'),
  ]);
  const params = new URLSearchParams(ctx.query);
  const writable = can(ctx.user, 'products', true);
  const filtered = products.filter((product) => {
    const term = (params.get('q') || '').toLowerCase();
    const blob = `${product.name} ${product.sku} ${product.internalCode} ${product.barcode || ''}`.toLowerCase();
    if (term && !blob.includes(term)) return false;
    if (params.get('type') && product.type !== params.get('type')) return false;
    if (params.get('status') && product.status !== params.get('status')) return false;
    if (params.get('categoryId') && String(product.categoryId) !== params.get('categoryId') && String(product.subcategoryId) !== params.get('categoryId')) return false;
    return true;
  });
  return {
    html: `${pageHead({ kicker: 'Cadastro central', title: 'Produtos', text: 'Unitários, kits e combos no mesmo cadastro. O saldo só muda por recebimento, produção, expedição ou inventário.', actions: writable ? '<a class="btn btn-primary" href="#/produtos/novo">Novo produto</a>' : '' })}
      <form class="filters" id="filters">
        <label class="field grow"><span>Pesquisar</span><input name="q" value="${esc(params.get('q') || '')}" placeholder="Nome, SKU, código ou barras"></label>
        <label class="field"><span>Tipo</span><select name="type"><option value="">Todos</option><option value="unitario">Unitário</option><option value="kit">Kit</option><option value="combo">Combo</option></select></label>
        <label class="field"><span>Status</span><select name="status"><option value="">Todos</option><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
        <label class="field"><span>Categoria</span><select name="categoryId"><option value="">Todas</option>${categories.map((item) => `<option value="${item.id}">${esc(item.parentName ? `${item.parentName} / ${item.name}` : item.name)}</option>`).join('')}</select></label>
      </form>
      <div class="table-wrap" style="margin-top:14px"><table>
        <thead><tr><th>Produto</th><th>SKU</th><th>Tipo</th><th class="num">Estoque</th><th class="num">Mínimo</th><th>Local</th><th>Status</th></tr></thead>
        <tbody>${filtered.map((product) => `<tr class="clickable" data-href="#/produtos/${product.id}">
          <td><div class="product-cell">${product.photo ? `<img class="thumb" src="${esc(product.photo)}" alt="">` : `<div class="ph">${esc(product.name.slice(0, 1))}</div>`}<div><b>${esc(product.name)}</b><small class="muted">${esc(product.internalCode)}</small></div></div></td>
          <td>${esc(product.sku)}</td><td>${pill('info', TYPE_LABEL[product.type])}</td>
          <td class="num ${product.minStock > 0 && product.stockQty <= product.minStock ? 'down' : ''}">${qty(product.stockQty)} ${esc(product.unit)}</td>
          <td class="num">${qty(product.minStock)}</td><td>${esc(product.location || '—')}</td><td>${statusPill(product.status)}</td>
        </tr>`).join('') || '<tr><td colspan="7">Nenhum produto encontrado.</td></tr>'}
        </tbody></table></div>`,
    bind(root) {
      const form = root.querySelector('#filters');
      form.type.value = params.get('type') || '';
      form.status.value = params.get('status') || '';
      form.categoryId.value = params.get('categoryId') || '';
      const go = () => {
        const next = new URLSearchParams(new FormData(form));
        location.hash = `#/produtos?${next.toString()}`;
      };
      form.onchange = go;
      form.q.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); go(); } };
      root.querySelectorAll('[data-href]').forEach((row) => { row.onclick = () => { location.hash = row.dataset.href; }; });
    },
  };
}

export async function renderProductForm(ctx) {
  const creating = !ctx.params.id;
  const [product, categories, units, materials] = await Promise.all([
    creating ? Promise.resolve(null) : api(`/api/products/${ctx.params.id}`),
    api('/api/categories'),
    api('/api/products?type=unitario'),
    api('/api/materials'),
  ]);
  const writable = can(ctx.user, 'products', true);
  const data = product || { type: 'unitario', status: 'ativo', unit: 'un', components: [], materials: [], minStock: 0, maxStock: 0, costPrice: 0, salePrice: 0 };
  const parents = categories.filter((item) => !item.parentId);
  const children = categories.filter((item) => item.parentId);
  return {
    html: `${pageHead({ kicker: 'Cadastro de produtos', title: creating ? 'Novo produto' : data.name, text: 'O saldo exibido é calculado pelo livro de movimentações e não é editável aqui.', actions: '<a class="btn" href="#/produtos">Voltar</a>' })}
      <form id="product-form" class="card">
        <div id="form-error"></div>
        <div class="form-grid">
          ${field('Código interno', `<input name="internalCode" required value="${esc(data.internalCode || '')}">`)}
          ${field('SKU', `<input name="sku" required value="${esc(data.sku || '')}">`)}
          ${field('Código de barras', `<input name="barcode" value="${esc(data.barcode || '')}" placeholder="Bipe o leitor aqui">`)}
          ${field('Nome', `<input name="name" required value="${esc(data.name || '')}">`, 'wide')}
          ${field('Marca', `<input name="brand" value="${esc(data.brand || '')}">`)}
          ${field('Categoria', `<select name="categoryId">${parents.map((item) => `<option value="${item.id}" ${item.id === data.categoryId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`)}
          ${field('Subcategoria', `<select name="subcategoryId"><option value="">—</option>${children.map((item) => `<option value="${item.id}" ${item.id === data.subcategoryId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`)}
          ${field('Unidade', `<input name="unit" value="${esc(data.unit || 'un')}">`)}
          ${field('Tipo', `<select name="type"><option value="unitario">Unitário</option><option value="kit">Kit</option><option value="combo">Combo</option></select>`)}
          ${field('Status', `<select name="status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select>`)}
          ${field('Estoque mínimo', `<input name="minStock" type="number" min="0" step="0.01" value="${data.minStock || 0}">`)}
          ${field('Estoque máximo', `<input name="maxStock" type="number" min="0" step="0.01" value="${data.maxStock || 0}">`)}
          ${field('Custo', `<input name="costPrice" type="number" min="0" step="0.01" value="${data.costPrice || 0}">`)}
          ${field('Preço de venda', `<input name="salePrice" type="number" min="0" step="0.01" value="${data.salePrice || 0}">`)}
          ${field('Localização', `<input name="location" value="${esc(data.location || '')}">`)}
          ${field('Saldo atual', `<input value="${qty(data.stockQty || 0)} ${esc(data.unit || 'un')}" disabled>`)}
          ${field('Descrição', `<textarea name="description">${esc(data.description || '')}</textarea>`, 'full')}
          ${field('Observações', `<textarea name="notes">${esc(data.notes || '')}</textarea>`, 'full')}
          ${field('Foto', '<input name="photo" type="file" accept="image/png,image/jpeg,image/webp">', 'full')}
        </div>
        <div id="combo-mode" class="checks" style="margin:12px 0"></div>
        <section id="composition"></section>
        ${writable ? '<button class="btn btn-primary" type="submit">Salvar cadastro</button>' : '<p class="help">Seu perfil pode consultar, sem alterar o cadastro.</p>'}
      </form>`,
    bind(root) {
      const form = root.querySelector('#product-form');
      form.type.value = data.type;
      form.status.value = data.status || 'ativo';
      let components = [...(data.components || [])];
      let packs = [...(data.materials || [])];
      let comboMode = data.comboMode || 'comercial';
      const drawComposition = () => {
        const type = form.type.value;
        root.querySelector('#combo-mode').innerHTML = type === 'combo' ? `<label><input type="radio" name="comboMode" value="fisico" ${comboMode === 'fisico' ? 'checked' : ''}> Montado fisicamente antes da venda</label><label><input type="radio" name="comboMode" value="comercial" ${comboMode !== 'fisico' ? 'checked' : ''}> Apenas combinação comercial</label>` : '';
        root.querySelector('#composition').innerHTML = type === 'unitario' ? '<p class="help">Produto unitário não possui composição. Ele entra direto no estoque.</p>' : `
          <h2>Composição do produto</h2>
          <div class="grid-2">
            <div><h3>Componentes</h3><div id="comp-list" class="list">${components.map((item, index) => `<div class="item"><span>${esc(item.name || units.find((unit) => unit.id === Number(item.productId))?.name || 'Item')} · ${qty(item.quantity)}</span><button type="button" data-remove-c="${index}" class="btn btn-sm">Remover</button></div>`).join('')}</div>
              <div class="filters"><select id="comp-id">${units.filter((unit) => unit.id !== data.id).map((unit) => `<option value="${unit.id}">${esc(unit.name)}</option>`).join('')}</select><input id="comp-qty" type="number" min="0.01" step="0.01" value="1" style="max-width:90px"><button type="button" class="btn" id="add-comp">Adicionar</button></div></div>
            <div><h3>Materiais de embalagem</h3><div id="mat-list" class="list">${packs.map((item, index) => `<div class="item"><span>${esc(item.name || materials.find((mat) => mat.id === Number(item.materialId))?.name || 'Material')} · ${qty(item.quantity)}</span><button type="button" data-remove-m="${index}" class="btn btn-sm">Remover</button></div>`).join('')}</div>
              <div class="filters"><select id="mat-id">${materials.map((item) => `<option value="${item.id}">${esc(item.name)} (${esc(item.unit)})</option>`).join('')}</select><input id="mat-qty" type="number" min="0.01" step="0.01" value="1" style="max-width:90px"><button type="button" class="btn" id="add-mat">Adicionar</button></div></div>
          </div>`;
        root.querySelector('#add-comp')?.addEventListener('click', () => {
          components.push({ productId: Number(root.querySelector('#comp-id').value), quantity: Number(root.querySelector('#comp-qty').value), name: root.querySelector('#comp-id').selectedOptions[0].textContent });
          drawComposition();
        });
        root.querySelector('#add-mat')?.addEventListener('click', () => {
          packs.push({ materialId: Number(root.querySelector('#mat-id').value), quantity: Number(root.querySelector('#mat-qty').value), name: root.querySelector('#mat-id').selectedOptions[0].textContent });
          drawComposition();
        });
        root.querySelectorAll('[data-remove-c]').forEach((button) => { button.onclick = () => { components.splice(Number(button.dataset.removeC), 1); drawComposition(); }; });
        root.querySelectorAll('[data-remove-m]').forEach((button) => { button.onclick = () => { packs.splice(Number(button.dataset.removeM), 1); drawComposition(); }; });
        root.querySelectorAll('input[name=comboMode]').forEach((input) => { input.onchange = () => { comboMode = input.value; }; });
      };
      form.type.onchange = drawComposition;
      drawComposition();
      form.onsubmit = async (event) => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.categoryId = payload.categoryId || null;
        payload.subcategoryId = payload.subcategoryId || null;
        payload.comboMode = payload.type === 'combo' ? comboMode : null;
        payload.components = payload.type === 'unitario' ? [] : components.map((item) => ({ productId: item.productId, quantity: item.quantity }));
        payload.materials = payload.type === 'unitario' ? [] : packs.map((item) => ({ materialId: item.materialId, quantity: item.quantity }));
        if (form.photo.files[0]) payload.photoFile = await readFile(form.photo.files[0]);
        delete payload.photo;
        try {
          const saved = await api(creating ? '/api/products' : `/api/products/${ctx.params.id}`, { method: creating ? 'POST' : 'PUT', body: payload });
          toast('Cadastro salvo.');
          location.hash = `#/produtos/${saved.id}`;
        } catch (error) {
          root.querySelector('#form-error').innerHTML = banner('danger', detailText(error));
        }
      };
    },
  };
}
