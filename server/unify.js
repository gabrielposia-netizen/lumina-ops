import { inflateSync } from 'node:zlib';
import { canWrite } from './auth.js';
import { audit, logAlert, one, q, run, transaction } from './db.js';
import { carrierRefusal, detectCarrier, productsFromLabelText, readablePdfText, registerMissingProducts } from './labelIntel.js';
import { HttpError, fold, now, sha256, today } from './lib.js';

function when(iso) {
  if (!iso) return '—';
  const [date, time = ''] = String(iso).split('T');
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year} ${time.slice(0, 5)}`;
}

function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  const parts = [raw];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try { parts.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1')); } catch { /* fluxo sem compressão */ }
  }
  return parts.join('\n');
}

function plausibleMark(mark) {
  return (mark.match(/00/g)?.length || 0) < 2;
}

function collectMarks(text, found) {
  for (const match of text.matchAll(/\(([0-9]{15,22})\)/g)) {
    if (plausibleMark(match[1])) found.add(match[1]);
  }
  for (const match of text.matchAll(/(?<!\d)([0-9]{15,22})(?!\d)/g)) {
    if (plausibleMark(match[1])) found.add(match[1]);
  }
  for (const match of text.matchAll(/<([0-9A-Fa-f]{8,})>/g)) {
    const hex = match[1].toUpperCase();
    if (!hex.startsWith('FEFF')) continue;
    let decoded = '';
    for (let index = 0; index + 3 < hex.length; index += 4) decoded += String.fromCharCode(parseInt(hex.slice(index, index + 4), 16));
    for (const mark of decoded.matchAll(/(?<!\d)([0-9]{15,22})(?!\d)/g)) {
      if (plausibleMark(mark[1])) found.add(mark[1]);
    }
  }
}

function extractMarks(buffer) {
  const found = new Set();
  const raw = buffer.toString('latin1');
  collectMarks(raw.replace(/stream\r?\n[\s\S]*?endstream/g, ' '), found);
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let text = match[1];
    try { text = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { /* fluxo sem compressão */ }
    const printable = [...text].filter((char) => char >= ' ' && char <= '~').length / Math.max(text.length, 1);
    if (printable > 0.85) collectMarks(text, found);
  }
  return [...found].slice(0, 30);
}

function countPages(buffer) {
  return pdfText(buffer).match(/\/Type\s*\/Page(?!s)/g)?.length || 0;
}

function sharedMarks(left, right) {
  const a = new Set(String(left || '').split(',').filter(Boolean));
  const b = String(right || '').split(',').filter(Boolean);
  return b.filter((mark) => a.has(mark));
}

function closeSize(left, right) {
  const a = Number(left) || 0;
  const b = Number(right) || 0;
  if (!a || !b) return false;
  return Math.abs(a - b) / Math.max(a, b) <= 0.05;
}

function publicPrint(row, shared = []) {
  return {
    id: row.id,
    sourceFile: row.sourceFile,
    userName: row.userName || 'alguém da operação',
    printedAt: row.printedAt,
    when: when(row.printedAt),
    status: row.status,
    shared,
  };
}

function noteEvent(review, userId, status, code) {
  const since = `${today()}T00:00:00`;
  const exists = one(
    `SELECT id FROM label_prints WHERE file_hash = ? AND status = ? AND user_id = ? AND printed_at >= ?`,
    [review.fileHash, status, userId, since],
  );
  if (exists) return;
  run(
    `INSERT INTO label_prints (file_hash, source_file, byte_size, page_count, marks, status, user_id, printed_at, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [review.fileHash, review.filename, review.byteSize, review.pageCount, (review.marks || []).join(','), status, userId, now().iso, review.message],
  );
  logAlert({
    level: 'warning',
    code,
    message: review.message,
    entity: 'label_print',
    entityId: review.fileHash,
  });
  audit(userId, 'etiqueta_unificada', review.fileHash, status, null, { filename: review.filename, carrier: review.carrier || null });
}

function noteBlocked(review, userId) {
  noteEvent(review, userId, 'bloqueada', 'etiqueta_duplicada_impressao');
}

export function inspectUnify({ filename, buffer, user, recordBlock = false }) {
  if (!buffer?.length) throw new HttpError(400, 'Envie o PDF da etiqueta.');
  if (buffer.subarray(0, 5).toString('utf8') !== '%PDF-') throw new HttpError(400, 'Envie um arquivo PDF de etiqueta.');
  const carrier = detectCarrier(buffer, filename);
  const refusal = carrierRefusal(carrier);
  const fileHash = sha256(buffer);
  const marks = extractMarks(buffer);
  const pageCount = countPages(buffer);
  const byteSize = buffer.length;
  const name = String(filename || 'etiqueta.pdf').slice(0, 120);
  const previous = one(
    `SELECT p.*, u.name AS user_name
     FROM label_prints p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.file_hash = ? AND p.status IN ('impressa', 'reimpressa')
     ORDER BY p.id ASC LIMIT 1`,
    [fileHash],
  );
  const others = q(
    `SELECT p.*, u.name AS user_name
     FROM label_prints p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.status IN ('impressa', 'reimpressa') AND p.file_hash != ?
     ORDER BY p.id DESC LIMIT 200`,
    [fileHash],
  );
  const similarOrders = [];
  const similarFiles = [];
  const markText = marks.join(',');
  for (const row of others) {
    const shared = sharedMarks(markText, row.marks);
    if (shared.length) similarOrders.push(publicPrint(row, shared));
    else if (fold(row.sourceFile) && fold(row.sourceFile) === fold(name) && closeSize(row.byteSize, byteSize)) similarFiles.push(publicPrint(row));
  }
  const canOverride = canWrite(user, 'label-reprint');
  let registered = [];
  let decision = 'liberado';
  let message = 'Etiqueta da J&T. Ainda não impressa. Pode unificar e imprimir uma vez.';
  if (refusal) {
    decision = 'recusada';
    message = refusal;
  } else if (user && canWrite(user, 'labels')) {
    registered = registerMissingProducts(productsFromLabelText(readablePdfText(buffer)), user.id);
    if (registered.length) message += ` O Gestor IA cadastrou ${registered.map((item) => item.name).join(', ')}.`;
  }
  if (decision === 'liberado' && previous) {
    decision = 'bloqueado';
    message = `Este arquivo já foi unificado e impresso por ${previous.userName} em ${when(previous.printedAt)}. Uma segunda impressão gastaria outra etiqueta.`;
  } else if (decision === 'liberado' && similarOrders.length) {
    decision = 'bloqueado';
    const hit = similarOrders[0];
    message = `Possível duplicidade: este PDF traz o mesmo pedido de ${hit.sourceFile}, impresso por ${hit.userName} em ${hit.when}. A impressão foi travada para não perder etiqueta.`;
  } else if (decision === 'liberado' && similarFiles.length) {
    decision = 'parecido';
    const hit = similarFiles[0];
    message = `O arquivo se parece com uma impressão de ${hit.when} feita por ${hit.userName}. Confirme que não é a mesma etiqueta antes de imprimir.`;
  }
  if (decision === 'bloqueado') {
    message += canOverride
      ? ' Como administrador, você pode autorizar a reimpressão.'
      : ' Só um administrador pode liberar essa reimpressão.';
  }
  const review = {
    fileHash,
    filename: name,
    byteSize,
    pageCount,
    marks,
    decision,
    carrier,
    registered,
    canOverride: decision === 'recusada' ? false : canOverride,
    message,
    previous: previous ? publicPrint(previous) : null,
    similarOrders,
    similarFiles,
  };
  if (recordBlock && decision === 'bloqueado') noteBlocked(review, user.id);
  if (recordBlock && decision === 'recusada') noteEvent(review, user.id, 'recusada', 'etiqueta_transportadora');
  return review;
}

export function commitUnify({ filename, buffer, user, widthMm, heightMm, override = false, acknowledgeSimilar = false }) {
  const review = inspectUnify({ filename, buffer, user, recordBlock: false });
  if (review.decision === 'recusada') {
    noteEvent(review, user.id, 'recusada', 'etiqueta_transportadora');
    throw new HttpError(403, review.message);
  }
  if (review.decision === 'bloqueado' && !override) {
    noteBlocked(review, user.id);
    throw new HttpError(409, review.message);
  }
  if (review.decision === 'bloqueado' && !canWrite(user, 'label-reprint')) {
    noteBlocked(review, user.id);
    throw new HttpError(403, 'Só um administrador pode autorizar a reimpressão desta etiqueta.');
  }
  if (review.decision === 'parecido' && !acknowledgeSimilar && !override) {
    throw new HttpError(409, review.message);
  }
  const status = review.decision === 'bloqueado' ? 'reimpressa' : 'impressa';
  const outputLabels = Math.max(1, Math.ceil((review.pageCount || 2) / 2));
  const printedAt = now().iso;
  const message = status === 'reimpressa'
    ? `Reimpressão autorizada por ${user.name}.`
    : 'Primeira impressão registrada. O arquivo não entra de novo.';
  const saved = transaction(() => {
    const again = one(
      `SELECT id FROM label_prints WHERE file_hash = ? AND status = 'impressa'`,
      [review.fileHash],
    );
    if (again && status === 'impressa') throw new HttpError(409, review.message);
    const created = run(
      `INSERT INTO label_prints (file_hash, source_file, byte_size, page_count, marks, width_mm, height_mm, output_labels, status, user_id, printed_at, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [review.fileHash, review.filename, review.byteSize, review.pageCount, review.marks.join(','), widthMm || null, heightMm || null, outputLabels, status, user.id, printedAt, message],
    );
    audit(user.id, 'etiqueta_unificada', created.id, status, null, { filename: review.filename, fileHash: review.fileHash });
    if (status === 'reimpressa') {
      logAlert({
        level: 'warning',
        code: 'reimpressao_autorizada',
        message: `${user.name} autorizou reimprimir ${review.filename}.`,
        entity: 'label_print',
        entityId: review.fileHash,
      });
    }
    return created;
  });
  return { id: saved.id, status, message, outputLabels, fileHash: review.fileHash };
}

export function listPrints() {
  return q(
    `SELECT p.*, u.name AS user_name
     FROM label_prints p LEFT JOIN users u ON u.id = p.user_id
     ORDER BY p.id DESC LIMIT 40`,
  ).map((row) => ({ ...publicPrint(row), message: row.message, pageCount: row.pageCount }));
}

export function labelSecurity() {
  const rows = q(
    `SELECT p.*, u.name AS user_name
     FROM label_prints p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.status IN ('impressa', 'reimpressa', 'bloqueada')
     ORDER BY p.id DESC LIMIT 200`,
  );
  const active = rows.filter((row) => row.status !== 'bloqueada');
  const pairs = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (active[i].fileHash === active[j].fileHash) continue;
      const shared = sharedMarks(active[i].marks, active[j].marks);
      const sameName = fold(active[i].sourceFile) && fold(active[i].sourceFile) === fold(active[j].sourceFile) && closeSize(active[i].byteSize, active[j].byteSize);
      if (!shared.length && !sameName) continue;
      pairs.push({
        left: active[i].sourceFile,
        right: active[j].sourceFile,
        kind: shared.length ? 'pedido' : 'arquivo',
        shared: shared[0] || '',
      });
      if (pairs.length >= 6) break;
    }
    if (pairs.length >= 6) break;
  }
  return {
    blocked: rows.filter((row) => row.status === 'bloqueada').map((row) => publicPrint(row)),
    reprints: rows.filter((row) => row.status === 'reimpressa').map((row) => publicPrint(row)),
    printed: active.filter((row) => row.status === 'impressa').length,
    pairs,
  };
}
