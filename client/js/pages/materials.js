import { api, can, detailText } from '../api.js';
import { banner, esc, field, pageHead, pill, qty, toast } from '../ui.js';

const STATUS = { ok: ['ok', 'Estável'], atencao: ['warn', 'Atenção'], critico: ['danger', 'Crítico'] };

export async function renderMaterials(ctx) {
  const [board, suppliers] = await Promise.all([api('/api/dashboard/packaging'), api('/api/suppliers')]);
  const writable = can(ctx.user, 'materials', true);
  return {
    html: `${pageHead({ kicker: 'Embalagens', title: 'Materiais de embalagem', text: 'Caixa, fita e plástico-bolha com consumo médio, cobertura em dias e o ponto em que a montagem para.', actions: writable ? '<button class="btn btn-primary" id="new-material" type="button">Novo material</button>' : '' })}
      <div class="grid-3">${board.map((item) => {
        const [kind, label] = STATUS[item.status] || STATUS.ok;
        const packs = item.packages != null ? `${qty(item.packages)} ${item.packageUnit || ''}` : '';
        return `<article class="card"><div class="card-head"><h2>${esc(item.name)}</h2>${pill(kind, label)}</div>
          <p style="font-size:28px;margin:0">${qty(item.stockQty)} <small>${esc(item.unit)}</small></p>
          <p class="muted">${packs}</p>
          <p>Consumo médio: <b>${qty(item.daily)} ${esc(item.unit)}/dia</b></p>
          <p>Estoque projetado: <b>${item.days == null ? 'sem consumo recente' : `${qty(item.days)} dias`}</b></p>
          <p class="help">Mínimo ${qty(item.minStock)} · ${esc(item.location || 'sem local')}</p>
          ${writable ? `<button class="btn btn-sm" type="button" data-edit="${item.id}">Editar</button>` : ''}
        </article>`;
      }).join('')}</div>`,
    bind(root) {
      const open = (current = {}) => {
        const { modal, field: drawField } = { modal: null };
        import('../ui.js').then(({ modal: openModal }) => {
          const box = openModal({
            title: current.id ? 'Editar material' : 'Novo material',
            body: `<form id="mat-form"><div class="form-grid">
              ${field('Código', `<input name="code" required value="${esc(current.code || '')}">`)}
              ${field('Nome', `<input name="name" required value="${esc(current.name || '')}">`, 'wide')}
              ${field('Tipo', `<input name="type" required value="${esc(current.type || 'Caixa')}" placeholder="Caixa, Fita, Proteção">`)}
              ${field('Unidade', `<input name="unit" required value="${esc(current.unit || 'un')}">`)}
              ${field('Unidade do volume', `<input name="packageUnit" value="${esc(current.packageUnit || '')}" placeholder="rolo">`)}
              ${field('Conteúdo do volume', `<input name="packageContent" type="number" step="0.01" value="${current.packageContent || ''}" placeholder="100">`)}
              ${field('Estoque mínimo', `<input name="minStock" type="number" step="0.01" value="${current.minStock || 0}">`)}
              ${field('Estoque máximo', `<input name="maxStock" type="number" step="0.01" value="${current.maxStock || 0}">`)}
              ${field('Localização', `<input name="location" value="${esc(current.location || '')}">`)}
              ${field('Fornecedor', `<select name="supplierId"><option value="">—</option>${suppliers.map((item) => `<option value="${item.id}" ${item.id === current.supplierId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`)}
              ${field('Observações', `<textarea name="notes">${esc(current.notes || '')}</textarea>`, 'full')}
            </div><p class="help">O saldo entra pelo recebimento. Este cadastro não altera a quantidade.</p><div id="mat-error"></div></form>`,
            footer: '<button class="btn btn-primary" type="button" id="save-mat">Salvar</button>',
          });
          box.root.querySelector('#save-mat').onclick = async () => {
            const form = box.root.querySelector('#mat-form');
            const body = Object.fromEntries(new FormData(form).entries());
            body.supplierId = body.supplierId || null;
            try {
              await api(current.id ? `/api/materials/${current.id}` : '/api/materials', { method: current.id ? 'PUT' : 'POST', body });
              toast('Material salvo.');
              box.close();
              ctx.reload();
            } catch (error) {
              box.root.querySelector('#mat-error').innerHTML = banner('danger', detailText(error));
            }
          };
        });
        void drawField;
      };
      root.querySelector('#new-material')?.addEventListener('click', () => open());
      root.querySelectorAll('[data-edit]').forEach((button) => {
        button.onclick = () => open(board.find((item) => String(item.id) === button.dataset.edit));
      });
    },
  };
}
