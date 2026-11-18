import { api } from '../api.js';
import { esc, pageHead, pill, qty } from '../ui.js';

export async function renderKits() {
  const [products, capacities] = await Promise.all([api('/api/products'), api('/api/kits/capacity')]);
  const composed = products.filter((item) => item.type === 'kit' || item.type === 'combo');
  const details = await Promise.all(composed.map((item) => api(`/api/products/${item.id}`)));
  return {
    html: `${pageHead({ kicker: 'Composição', title: 'Kits e combos', text: 'Kit montado baixa componentes na produção e, na expedição, baixa só o kit. Combo comercial baixa os componentes na hora da saída.' })}
      ${capacities.map((item) => `<article class="card"><div class="card-head"><div><h2>${esc(item.productName)}</h2><p>${esc(item.sentence)}</p></div>${pill(item.max < 100 ? 'warn' : 'ok', `${qty(item.max)} possíveis`)}</div>
        <div class="table-wrap"><table><thead><tr><th>Item</th><th>Tipo</th><th class="num">Disponível</th><th class="num">Por kit</th><th class="num">Limite</th></tr></thead><tbody>
          ${item.limits.map((line) => `<tr><td>${esc(line.name)} ${line.limiting ? pill('danger', 'Gargalo') : ''}</td><td>${esc(line.kind)}</td><td class="num">${qty(line.stock)} ${esc(line.unit)}</td><td class="num">${qty(line.perUnit)}</td><td class="num">${qty(line.can)}</td></tr>`).join('') || '<tr><td colspan="5">Sem composição.</td></tr>'}
        </tbody></table></div></article>`).join('')}
      ${details.filter((item) => item.type === 'combo').map((item) => `<article class="card"><div class="card-head"><h2>${esc(item.name)}</h2>${pill('info', item.comboMode === 'comercial' ? 'Combinação comercial' : 'Montado fisicamente')}</div>
        <p>${item.components.map((component) => `${qty(component.quantity)}× ${esc(component.name)}`).join(' · ') || 'Sem componentes.'}</p>
        <a href="#/produtos/${item.id}">Abrir cadastro</a></article>`).join('')}`,
  };
}
