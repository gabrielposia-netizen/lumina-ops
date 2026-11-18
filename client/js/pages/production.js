import { api, can, detailText } from '../api.js';
import { lineChart } from '../charts.js';
import { banner, dateBR, esc, field, impacts, pageHead, pct, qty, toast } from '../ui.js';

export async function renderProduction(ctx) {
  const [kits, users, shifts, history, dashboard] = await Promise.all([
    api('/api/products'),
    api('/api/users').catch(() => [ctx.user]),
    api('/api/shifts').catch(() => []),
    api('/api/production'),
    api('/api/dashboard/production').catch(() => null),
  ]);
  const producible = kits.filter((item) => item.type === 'kit' || (item.type === 'combo' && item.comboMode === 'fisico'));
  const writable = can(ctx.user, 'production', true);
  return {
    html: `${pageHead({ kicker: 'Montagem', title: 'Produção', text: 'Informe o kit e a quantidade. A entrada do acabado e a baixa dos componentes e embalagens acontecem juntas.' })}
      ${dashboard ? `<section class="kpi-grid">
        <article class="kpi"><span>Hoje</span><strong>${qty(dashboard.today.qty)}</strong><em>${pct(dashboard.today.efficiency)} da meta</em></article>
        <article class="kpi"><span>Ontem</span><strong>${qty(dashboard.yesterday.qty)}</strong><em>${pct(dashboard.yesterday.efficiency)}</em></article>
        <article class="kpi"><span>Semana</span><strong>${qty(dashboard.week.qty)}</strong><em>últimos 7 dias</em></article>
        <article class="kpi"><span>Mês</span><strong>${qty(dashboard.month.qty)}</strong><em>até hoje</em></article>
      </section>` : ''}
      ${dashboard ? `<article class="card"><div class="card-head"><h2>Evolução no mês</h2></div>${lineChart(dashboard.byDay)}</article>` : ''}
      ${writable ? `<form class="card" id="prod-form"><div id="prod-error"></div><div class="form-grid">
        ${field('Kit', `<select name="productId">${producible.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select>`, 'wide')}
        ${field('Quantidade', '<input name="quantity" type="number" min="1" step="1" value="1" required>')}
        ${field('Colaborador', `<select name="userId">${users.filter((item) => item.active !== false).map((item) => `<option value="${item.id}" ${item.id === ctx.user.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`)}
        ${field('Turno', `<select name="shiftId"><option value="">—</option>${shifts.map((item) => `<option value="${item.id}">${esc(item.name)} · ${esc(item.startTime)}–${esc(item.endTime)}</option>`).join('')}</select>`)}
        ${field('Data', `<input type="date" name="date" value="${ctx.today}">`)}
        ${field('Hora', `<input type="time" name="time" value="${new Date().toTimeString().slice(0, 5)}">`)}
        ${field('Ordem de produção', '<input name="orderCode" placeholder="Gerada automaticamente">')}
        ${field('Lote do kit', '<input name="lotCode" placeholder="Gerado pela data">')}
        ${field('Observação', '<input name="notes">', 'wide')}
      </div><div id="capacity" class="banner banner-info" style="margin-top:12px">Calculando capacidade…</div>
      <button class="btn btn-primary" type="submit">Registrar montagem</button><div id="prod-result"></div></form>` : '<p class="help">Seu perfil consulta a produção sem registrar montagem.</p>'}
      <article class="card"><div class="card-head"><h2>Histórico</h2></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>OP</th><th>Kit</th><th class="num">Qtd</th><th>Colaborador</th><th>Turno</th><th>Status</th><th></th></tr></thead><tbody>
        ${history.slice(0, 40).map((item) => `<tr><td>${dateBR(item.date)} ${esc((item.time || '').slice(0, 5))}</td><td>${esc(item.orderCode)}</td><td>${esc(item.productName)}</td><td class="num">${qty(item.quantity)}</td><td>${esc(item.userName)}</td><td>${esc(item.shiftName || '—')}</td><td>${esc(item.status)}</td><td>${item.status === 'confirmada' && writable ? `<button class="btn btn-sm" data-reverse="${item.id}" type="button">Estornar</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></article>`,
    bind(root) {
      const form = root.querySelector('#prod-form');
      if (!form) return;
      const showCapacity = async () => {
        const data = await api(`/api/products/${form.productId.value}/capacity`);
        root.querySelector('#capacity').className = `banner ${data.max <= 0 ? 'banner-danger' : 'banner-info'}`;
        root.querySelector('#capacity').textContent = data.sentence;
      };
      form.productId.onchange = showCapacity;
      showCapacity();
      form.onsubmit = async (event) => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(form).entries());
        body.shiftId = body.shiftId || null;
        try {
          const result = await api('/api/production', { method: 'POST', body });
          root.querySelector('#prod-result').innerHTML = `${banner('ok', `${result.production.orderCode} confirmada. Entrada do kit e baixa dos componentes registradas.`)}${impacts(result.impacts)}`;
          toast('Montagem registrada.');
          showCapacity();
        } catch (error) {
          root.querySelector('#prod-error').innerHTML = banner('danger', detailText(error));
        }
      };
      root.querySelectorAll('[data-reverse]').forEach((button) => {
        button.onclick = async () => {
          const reason = prompt('Motivo do estorno');
          if (!reason) return;
          try {
            await api(`/api/production/${button.dataset.reverse}/reverse`, { method: 'POST', body: { reason } });
            toast('Produção estornada. Os saldos voltaram.');
            ctx.reload();
          } catch (error) { toast(error.message, 'danger'); }
        };
      });
    },
  };
}
