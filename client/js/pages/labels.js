import { api, can, detailText } from '../api.js';
import { LABEL_SIZES, mergeShippingAndPacking, openUnifiedPdf } from '../mergeLabels.js';
import { banner, dateBR, esc, pageHead, pill, qty, readFile, toast } from '../ui.js';

const TONE = { pronto: 'ok', atencao: 'warn', bloqueado: 'danger', confirmada: 'ok' };

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function renderLabels(ctx) {
  const [history, prints] = await Promise.all([api('/api/labels'), api('/api/labels/prints')]);
  const writable = can(ctx.user, 'labels', true);
  const tone = { impressa: 'ok', reimpressa: 'warn', bloqueada: 'danger' };
  const statusLabel = { impressa: 'Impressa', reimpressa: 'Reimpressa', bloqueada: 'Travada' };
  return {
    html: `${pageHead({ kicker: 'Rastreabilidade', title: 'Etiquetas', text: 'O arquivo é lido e validado antes de qualquer baixa. A mesma etiqueta não passa duas vezes.' })}
      <section class="card">
        <div class="card-head"><h2>Unificar e imprimir</h2><p>Só etiqueta da J&T. Shopee e Shein não unificam. O mesmo arquivo não imprime de novo.</p></div>
        <div class="form-grid" style="grid-template-columns:1.4fr .8fr">
          <label class="field"><span>PDF do TikTok / J&T</span><input id="unify-file" type="file" accept="application/pdf,.pdf"></label>
          <label class="field"><span>Tamanho da etiqueta</span><select id="unify-size">${LABEL_SIZES.map((size) => `<option value="${size.id}">${esc(size.label)}</option>`).join('')}</select></label>
        </div>
        <div class="page-actions" style="margin-top:12px">
          <button class="btn btn-sm" id="unify-sample" type="button">Etiqueta J&T</button>
          <button class="btn btn-sm" id="unify-shopee" type="button">Etiqueta Shopee</button>
          <button class="btn btn-sm" id="unify-shein" type="button">Etiqueta Shein</button>
        </div>
        <div id="unify-result"></div>
        <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Arquivo</th><th>Quando</th><th>Quem</th><th>Situação</th></tr></thead><tbody>
          ${prints.length ? prints.map((item) => `<tr><td>${esc(item.sourceFile || '—')}</td><td>${esc(item.when)}</td><td>${esc(item.userName)}</td><td>${pill(tone[item.status] || 'info', statusLabel[item.status] || item.status)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Nenhuma unificação registrada.</td></tr>'}
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="drop" id="drop"><strong>Solte o arquivo aqui</strong><p>CSV, TXT, Excel, JSON ou PDF.</p><input id="file" type="file" accept=".csv,.txt,.xlsx,.json,.pdf"></div>
        <div class="page-actions" style="margin-top:12px">
          <button class="btn btn-sm" id="sample" type="button">Usar arquivo de exemplo</button>
          <button class="btn btn-sm" id="sample-bad" type="button">Arquivo com pendência</button>
        </div>
        <div id="preview"></div>
      </section>
      <article class="card"><div class="card-head"><h2>Etiquetas processadas</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Código</th><th>Produto</th><th class="num">Qtd</th><th>Lote</th><th>Status</th><th>Quando</th></tr></thead><tbody>
          ${history.map((item) => `<tr><td>${esc(item.sourceFile || '—')}</td><td>${esc(item.code || '')}</td><td>${esc(item.productName || '')}</td><td class="num">${qty(item.quantity)}</td><td>${esc(item.lotCode || '—')}</td><td>${pill(TONE[item.status] || 'info', item.status)}</td><td>${item.processedAt ? dateBR(item.processedAt) : '—'}</td></tr>`).join('')}
        </tbody></table></div></article>`,
    bind(root) {
      let pending = null;
      const result = root.querySelector('#unify-result');
      const paintUnify = (review) => {
        const refused = review.decision === 'recusada';
        const blocked = review.decision === 'bloqueado' || refused;
        const similar = review.decision === 'parecido';
        const created = review.registered?.length ? `Gestor IA cadastrou: ${review.registered.map((item) => `${item.name} (${item.sku})`).join(', ')}.` : '';
        result.innerHTML = `
          ${banner(blocked ? 'danger' : similar ? 'warn' : 'ok', review.message)}
          ${created ? banner('info', created) : ''}
          ${similar ? '<label class="checks" style="margin:10px 0"><input id="unify-ack" type="checkbox"> Confirmo que não é a mesma etiqueta</label>' : ''}
          ${writable && !blocked ? '<div class="page-actions"><button class="btn btn-primary" id="unify-print" type="button">Unificar e imprimir</button></div>' : ''}
          ${writable && review.decision === 'bloqueado' && review.canOverride ? '<div class="page-actions"><button class="btn btn-primary" id="unify-print" data-override="1" type="button">Autorizar reimpressão</button></div>' : ''}`;
        result.querySelector('#unify-print')?.addEventListener('click', printUnified);
      };
      const sendUnify = async (payload) => {
        pending = { payload };
        const review = await api('/api/labels/unify/check', { method: 'POST', body: payload });
        pending.review = review;
        paintUnify(review);
      };
      const printUnified = async (event) => {
        if (!pending?.payload) return;
        const override = event.currentTarget.dataset.override === '1';
        const acknowledgeSimilar = Boolean(result.querySelector('#unify-ack')?.checked);
        if (pending.review?.decision === 'parecido' && !acknowledgeSimilar) {
          toast('Confirme que não é a mesma etiqueta.', 'danger');
          return;
        }
        const size = LABEL_SIZES.find((item) => item.id === root.querySelector('#unify-size').value) || LABEL_SIZES[0];
        event.currentTarget.disabled = true;
        try {
          await api('/api/labels/unify/commit', {
            method: 'POST',
            body: { ...pending.payload, widthMm: size.widthMm, heightMm: size.heightMm, override, acknowledgeSimilar },
          });
          const merged = await mergeShippingAndPacking(bytesFromBase64(pending.payload.contentBase64), {
            widthMm: size.widthMm,
            heightMm: size.heightMm,
          });
          const base = String(pending.payload.filename || 'etiqueta.pdf').replace(/\.pdf$/i, '');
          openUnifiedPdf(merged.bytes, `${base}-unificada.pdf`);
          toast(override ? 'Reimpressão autorizada e registrada.' : 'Etiqueta unificada. Este arquivo não imprime de novo.');
          ctx.reload();
        } catch (error) {
          toast(detailText(error), 'danger');
          event.currentTarget.disabled = false;
        }
      };
      root.querySelector('#unify-file').onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try { await sendUnify(await readFile(file)); }
        catch (error) { result.innerHTML = banner('danger', error.message); }
      };
      const loadPdf = async (path, filename) => {
        try {
          const response = await fetch(path);
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
          await sendUnify({ filename, contentBase64: btoa(binary) });
        } catch (error) {
          result.innerHTML = banner('danger', error.message);
        }
      };
      root.querySelector('#unify-sample').onclick = () => loadPdf('/amostras/etiqueta-frete.pdf', 'etiqueta-jet.pdf');
      root.querySelector('#unify-shopee').onclick = () => loadPdf('/amostras/etiqueta-shopee.pdf', 'etiqueta-shopee.pdf');
      root.querySelector('#unify-shein').onclick = () => loadPdf('/amostras/etiqueta-shein.pdf', 'etiqueta-shein.pdf');
      let current = null;
      const renderPreview = (preview) => {
        current = preview;
        const blocked = preview.summary.blocked > 0;
        root.querySelector('#preview').innerHTML = `
          ${preview.registered?.length ? banner('info', `Gestor IA cadastrou: ${preview.registered.map((item) => `${item.name} (${item.sku})`).join(', ')}.`) : ''}
          ${preview.error ? banner('warn', preview.error) : ''}
          ${preview.summary.duplicateFile ? banner('danger', 'Etiqueta já processada. Nenhuma nova baixa será feita.') : ''}
          <div class="kpi-grid" style="margin:12px 0">
            <article class="kpi"><span>Prontas</span><strong>${preview.summary.ready}</strong></article>
            <article class="kpi"><span>Atenção</span><strong>${preview.summary.attention}</strong></article>
            <article class="kpi"><span>Bloqueadas</span><strong>${preview.summary.blocked}</strong></article>
          </div>
          <div class="table-wrap"><table><thead><tr><th>Código</th><th>Produto</th><th class="num">Qtd</th><th>Lote</th><th>Validação</th></tr></thead><tbody>
            ${preview.rows.map((row) => `<tr><td>${esc(row.code)}</td><td>${esc(row.resolvedName || row.productName)}</td><td class="num">${row.quantity ?? '—'}</td><td>${esc(row.lot || '—')}</td><td>${pill(TONE[row.status] || 'info', row.status)} ${esc(row.messages.join(' · '))}</td></tr>`).join('')}
          </tbody></table></div>
          ${writable && preview.rows.some((row) => row.status !== 'bloqueado') ? `<div class="page-actions" style="margin-top:12px"><button class="btn btn-primary" id="confirm" type="button">${blocked ? 'Confirmar apenas as válidas' : 'Confirmar movimentação'}</button></div>` : ''}`;
        root.querySelector('#confirm')?.addEventListener('click', async () => {
          try {
            const result = await api('/api/labels/confirm', { method: 'POST', body: { ...currentFile(), onlyValid: blocked } });
            const moved = result.results?.filter((row) => row.status === 'confirmada').length || 0;
            toast(`${moved} etiqueta(s) confirmada(s).`);
            ctx.reload();
          } catch (error) { toast(detailText(error), 'danger'); }
        });
      };
      const currentFile = () => current?.payload;
      const send = async (payload) => {
        current = { payload };
        const preview = await api('/api/labels/preview', { method: 'POST', body: payload });
        preview.payload = payload;
        current = preview;
        renderPreview(preview);
      };
      root.querySelector('#file').onchange = async (event) => {
        const file = event.target.files[0];
        if (file) send(await readFile(file));
      };
      const drop = root.querySelector('#drop');
      drop.ondragover = (event) => { event.preventDefault(); drop.classList.add('hot'); };
      drop.ondragleave = () => drop.classList.remove('hot');
      drop.ondrop = async (event) => {
        event.preventDefault();
        drop.classList.remove('hot');
        const file = event.dataTransfer.files[0];
        if (file) send(await readFile(file));
      };
      const loadSample = async (path) => {
        const response = await fetch(path);
        const text = await response.text();
        const contentBase64 = btoa(unescape(encodeURIComponent(text)));
        send({ filename: path.split('/').pop(), contentBase64 });
      };
      root.querySelector('#sample').onclick = () => loadSample('/amostras/etiquetas.csv');
      root.querySelector('#sample-bad').onclick = () => loadSample('/amostras/etiquetas-com-pendencia.csv');
    },
  };
}
