import { api } from '../api.js';
import { esc, pageHead, qty } from '../ui.js';

const STARTERS = [
  'Quantos kits consigo produzir hoje?',
  'Qual produto está com estoque crítico?',
  'Quanto de Caixa 15 eu tenho?',
  'Quantas Progressivas entraram este mês?',
  'Qual foi minha produção hoje?',
  'Quem produziu mais hoje?',
  'Qual foi meu produto mais vendido?',
  'Quanto plástico-bolha vou precisar para produzir 500 kits?',
  'Qual material de embalagem será meu gargalo?',
  'Quantos dias meu estoque de Caixa 15 vai durar?',
  'Tem etiqueta duplicada para imprimir?',
  'Posso unificar etiqueta da Shopee?',
];

export async function renderAi(ctx) {
  return {
    html: `${pageHead({ kicker: 'Inteligência da operação', title: 'Gestor IA', text: 'Pergunte em português. As respostas saem do estoque, da produção e das embalagens — não de um texto genérico.' })}
      <section class="chat">
        <aside class="card suggestions"><h2>Perguntas úteis</h2>${STARTERS.map((item) => `<button type="button" data-q="${esc(item)}">${esc(item)}</button>`).join('')}</aside>
        <section class="card thread">
          <div id="messages" style="display:flex;flex-direction:column;gap:12px"></div>
          <form class="composer" id="ask"><input name="question" placeholder="Ex.: quantos kits consigo produzir?" autocomplete="off"><button class="btn btn-primary" type="submit">Perguntar</button></form>
        </section>
      </section>`,
    bind(root) {
      const messages = [];
      const box = root.querySelector('#messages');
      const paint = () => {
        box.innerHTML = messages.map((message) => message.role === 'user'
          ? `<div class="bubble user">${esc(message.text)}</div>`
          : `<div class="bubble bot"><b>${esc(message.title)}</b><p>${esc(message.answer)}</p>
              ${message.metrics?.length ? `<div class="metrics">${message.metrics.map((metric) => `<div class="metric"><span class="muted">${esc(metric.label)}</span><b>${esc(metric.value)}</b><small class="muted">${esc(metric.hint || '')}</small></div>`).join('')}</div>` : ''}
              ${message.table ? `<div class="table-wrap" style="margin-top:10px"><table><thead><tr>${message.table.columns.map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr></thead><tbody>${message.table.rows.map((row) => `<tr>${message.table.columns.map((column) => `<td>${typeof row[column.key] === 'number' ? qty(row[column.key]) : esc(row[column.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
            </div>`).join('');
        box.scrollTop = box.scrollHeight;
      };
      const ask = async (question) => {
        messages.push({ role: 'user', text: question });
        paint();
        const answer = await api('/api/ai/ask', { method: 'POST', body: { question } });
        messages.push({ role: 'bot', ...answer });
        paint();
      };
      root.querySelectorAll('[data-q]').forEach((button) => { button.onclick = () => ask(button.dataset.q); });
      root.querySelector('#ask').onsubmit = (event) => {
        event.preventDefault();
        const question = event.target.question.value.trim();
        if (!question) return;
        event.target.question.value = '';
        ask(question);
      };
      ask('Como está a operação hoje?');
      void ctx;
    },
  };
}
