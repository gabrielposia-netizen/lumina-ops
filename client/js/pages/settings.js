import { api, can, detailText } from '../api.js';
import { banner, dateBR, esc, field, pageHead, toast } from '../ui.js';

const ROLES = [['admin', 'Administrador'], ['gestor', 'Gestor'], ['estoque', 'Estoque'], ['producao', 'Produção'], ['expedicao', 'Expedição'], ['consulta', 'Consulta']];

export async function renderSettings(ctx) {
  const tab = ctx.query.aba || 'usuarios';
  const [users, shifts, suppliers, categories, goals, audit] = await Promise.all([
    api('/api/users').catch(() => []),
    api('/api/shifts').catch(() => []),
    api('/api/suppliers').catch(() => []),
    api('/api/categories').catch(() => []),
    api('/api/goals').catch(() => []),
    api('/api/audit').catch(() => []),
  ]);
  const tabs = [['usuarios', 'Usuários'], ['turnos', 'Turnos'], ['metas', 'Metas'], ['fornecedores', 'Fornecedores'], ['categorias', 'Categorias'], ['auditoria', 'Auditoria'], ['integracoes', 'Integrações']];
  let body = '';
  if (tab === 'usuarios') {
    body = `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th></tr></thead><tbody>
      ${users.map((user) => `<tr><td>${esc(user.name)}</td><td>${esc(user.email)}</td><td>${esc(user.roleLabel)}</td><td>${user.active ? 'Ativo' : 'Inativo'}</td></tr>`).join('')}
    </tbody></table></div>
    ${can(ctx.user, 'users', true) ? `<form class="card" id="user-form"><h2>Novo usuário</h2><div class="form-grid">
      ${field('Nome', '<input name="name" required>')}
      ${field('E-mail', '<input name="email" type="email" required>')}
      ${field('Senha', '<input name="password" type="text" required minlength="6">')}
      ${field('Perfil', `<select name="role">${ROLES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>`)}
    </div><button class="btn btn-primary" type="submit">Criar acesso</button><div id="user-error"></div></form>` : '<p class="help">Somente o administrador cria acessos. Os demais perfis estão limitados ao que a operação precisa.</p>'}
    <article class="card"><h2>O que cada perfil faz</h2><p>Administrador: tudo. Gestor: operação, relatórios e IA. Estoque: entradas, saídas e inventário. Produção: montagem. Expedição: etiquetas e saídas. Consulta: somente visualização.</p></article>`;
  } else if (tab === 'turnos') {
    body = shifts.map((shift) => `<article class="card"><h2>${esc(shift.name)}</h2><p>${esc(shift.startTime)} às ${esc(shift.endTime)} · meta ${esc(shift.targetQty)} kits</p><p>${shift.members.map((member) => esc(member.name)).join(', ') || 'Sem colaboradores.'}</p></article>`).join('')
      + (can(ctx.user, 'shifts', true) ? `<form class="card" id="shift-form"><h2>Novo turno</h2><div class="form-grid">${field('Nome', '<input name="name" required>')}${field('Início', '<input name="startTime" placeholder="07:00" required>')}${field('Fim', '<input name="endTime" placeholder="16:00" required>')}${field('Meta', '<input name="targetQty" type="number" value="0">')}</div><button class="btn btn-primary">Salvar turno</button></form>` : '');
  } else if (tab === 'metas') {
    body = `<div class="list">${goals.map((goal) => `<div class="item"><span>${esc(goal.userName)}</span><b>${esc(goal.targetQty)} / dia</b></div>`).join('')}</div>
      ${can(ctx.user, 'goals', true) ? `<form class="card" id="goal-form"><div class="form-grid">${field('Colaborador', `<select name="userId">${users.map((user) => `<option value="${user.id}">${esc(user.name)}</option>`).join('')}</select>`)}${field('Meta diária', '<input name="targetQty" type="number" min="1" required>')}</div><button class="btn btn-primary">Salvar meta</button></form>` : ''}`;
  } else if (tab === 'fornecedores') {
    body = `<div class="list">${suppliers.map((item) => `<div class="item"><div><b>${esc(item.name)}</b><div class="muted">${esc(item.email || item.phone || '')}</div></div></div>`).join('')}</div>
      ${can(ctx.user, 'suppliers', true) ? `<form class="card" id="supplier-form"><div class="form-grid">${field('Nome', '<input name="name" required>')}${field('Documento', '<input name="document">')}${field('Contato', '<input name="contact">')}${field('Telefone', '<input name="phone">')}${field('E-mail', '<input name="email">')}</div><button class="btn btn-primary">Salvar fornecedor</button></form>` : ''}`;
  } else if (tab === 'categorias') {
    body = `<div class="list">${categories.map((item) => `<div class="item"><span>${esc(item.parentName ? `${item.parentName} / ${item.name}` : item.name)}</span></div>`).join('')}</div>
      ${can(ctx.user, 'categories', true) ? `<form class="card" id="category-form"><div class="form-grid">${field('Nome', '<input name="name" required>')}${field('Categoria pai', `<select name="parentId"><option value="">Nenhuma</option>${categories.filter((item) => !item.parentId).map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select>`)}</div><button class="btn btn-primary">Salvar categoria</button></form>` : ''}`;
  } else if (tab === 'auditoria') {
    body = `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Entidade</th><th>Ação</th></tr></thead><tbody>
      ${audit.map((item) => `<tr><td>${dateBR(item.occurredAt)} ${esc((item.occurredAt || '').slice(11, 16))}</td><td>${esc(item.userName || '')}</td><td>${esc(item.entity)} ${esc(item.entityId || '')}</td><td>${esc(item.action)}</td></tr>`).join('')}
    </tbody></table></div>`;
  } else {
    body = `<article class="card"><h2>Pronta para crescer</h2><p>A API já recebe pedido de canal e devolve o estoque. Leitor de barras, coletor, etiqueta, marketplace, ERP e transportadora entram por esses mesmos contratos, sem relançar a operação.</p>
      <p><code>GET /api/v1/estoque</code> · saldo para ERP ou Power BI</p>
      <p><code>GET /api/v1/produtos</code> · catálogo</p>
      <p><code>POST /api/v1/integracoes/pedidos</code></p>
      <pre>{
  "origem": "mercado-livre",
  "pedido": "ML-100245",
  "itens": [{ "sku": "KIT-MAR-001", "quantidade": 2 }]
}</pre>
      <p class="help">O pedido usa a mesma regra da expedição: kit baixa o kit, combo comercial baixa os componentes.</p></article>
      ${can(ctx.user, 'admin', true) ? '<article class="card"><h2>Demonstração</h2><p>Restaurar apaga os lançamentos desta base e recria a operação de exemplo.</p><button class="btn btn-danger" id="reset" type="button">Restaurar dados de demonstração</button></article>' : ''}`;
  }
  return {
    html: `${pageHead({ kicker: ctx.operation || 'Lúmina Hair', title: 'Configurações', text: `${ctx.company || 'Lúmina Ops'} · perfis, turnos, metas e a porta de integração.` })}
      <div class="tabs">${tabs.map(([id, label]) => `<button class="btn btn-sm ${tab === id ? 'active' : ''}" data-tab="${id}" type="button">${label}</button>`).join('')}</div>${body}`,
    bind(root) {
      root.querySelectorAll('[data-tab]').forEach((button) => { button.onclick = () => { location.hash = `#/configuracoes?aba=${button.dataset.tab}`; }; });
      const submit = async (id, url, map = (body) => body) => {
        const form = root.querySelector(id);
        if (!form) return;
        form.onsubmit = async (event) => {
          event.preventDefault();
          try {
            await api(url, { method: 'POST', body: map(Object.fromEntries(new FormData(form).entries())) });
            toast('Registro salvo.');
            ctx.reload();
          } catch (error) { toast(detailText(error), 'danger'); }
        };
      };
      submit('#user-form', '/api/users');
      submit('#shift-form', '/api/shifts', (body) => ({ ...body, memberIds: [] }));
      submit('#goal-form', '/api/goals');
      submit('#supplier-form', '/api/suppliers');
      submit('#category-form', '/api/categories', (body) => ({ ...body, parentId: body.parentId || null }));
      root.querySelector('#reset')?.addEventListener('click', async () => {
        if (!confirm('Isso recria a base de demonstração e apaga o que foi lançado nesta instalação. Continuar?')) return;
        await api('/api/admin/reset-demo', { method: 'POST', body: {} });
        toast('Demonstração restaurada.');
        location.reload();
      });
    },
  };
}
