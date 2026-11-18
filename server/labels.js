import { canWrite } from './auth.js';
import { logAlert, one, q, run, saveUpload, transaction } from './db.js';
import { findProductByCode } from './catalog.js';
import { registerMissingProducts } from './labelIntel.js';
import { fold, HttpError, sha256, today } from './lib.js';
import { parseLabelFile } from './parseFile.js';
import { expedite, shipmentCheck } from './stock.js';

function logicalUid(fileHash, row) {
  if (row.externalId) return `ext:${fold(row.externalId)}`;
  return `file:${fileHash}:${row.line}`;
}

function usedIdentity(uid) {
  return one(`SELECT id, status FROM labels WHERE uid = ? AND status IN ('confirmada', 'estornada')`, [uid]);
}

function classify(row, fileHash, fileUsed) {
  const uid = logicalUid(fileHash, row);
  const messages = [];
  let status = 'pronto';
  const block = (message) => {
    status = 'bloqueado';
    messages.push(message);
  };
  const warn = (message) => {
    if (status !== 'bloqueado') status = 'atencao';
    messages.push(message);
  };
  const product = findProductByCode(row.code, row.productName);
  if (!product) block('Produto sem cadastro');
  else messages.push('Produto encontrado');
  if (!(row.quantity > 0)) block('Quantidade inválida');
  else messages.push('Quantidade válida');
  if (fileUsed || usedIdentity(uid)) block('Etiqueta já processada');
  let lot = { state: 'na', message: 'Sem lote na etiqueta' };
  if (product && row.quantity > 0 && status !== 'bloqueado') {
    const check = shipmentCheck(product.id, row.quantity, row.lot);
    lot = check.lot;
    if (check.shortages.length) block('Estoque insuficiente');
    else messages.push('Estoque disponível');
    if (lot?.state === 'ok') messages.push('Lote identificado');
    else if (lot?.state === 'warn') warn(lot.message);
    else if (lot?.message) messages.push(lot.message);
  } else if (product && row.lot) {
    messages.push('Lote informado');
  }
  return {
    ...row,
    uid,
    productId: product?.id || null,
    resolvedName: product?.name || row.productName,
    productType: product?.type || null,
    status,
    messages,
    lotCheck: lot,
  };
}

export function previewLabels({ filename, buffer, user = null }) {
  const fileHash = sha256(buffer);
  const parsed = parseLabelFile({ filename, buffer });
  const registered = user && canWrite(user, 'labels')
    ? registerMissingProducts(parsed.rows, user.id)
    : [];
  const fileUsed = one(`SELECT id FROM labels WHERE file_hash = ? AND status = 'confirmada' LIMIT 1`, [fileHash]);
  const rows = (parsed.rows || []).map((row) => classify(row, fileHash, Boolean(fileUsed)));
  const summary = {
    ready: rows.filter((row) => row.status === 'pronto').length,
    attention: rows.filter((row) => row.status === 'atencao').length,
    blocked: rows.filter((row) => row.status === 'bloqueado').length,
    duplicateFile: Boolean(fileUsed),
  };
  return {
    fileHash,
    sourceFile: filename,
    error: parsed.error,
    rows,
    summary,
    registered,
  };
}

export function confirmLabels({ filename, buffer, userId, onlyValid = false }) {
  const preview = previewLabels({ filename, buffer });
  if (preview.error && !preview.rows.length) throw new HttpError(400, preview.error);
  if (preview.summary.duplicateFile) {
    logAlert({ level: 'warning', code: 'etiqueta_duplicada', message: `Arquivo já processado: ${filename}. Nenhuma nova baixa foi feita.`, entity: 'label' });
    throw new HttpError(409, 'Etiqueta já processada. Nenhuma nova baixa foi feita.', preview.rows);
  }
  const blocked = preview.rows.filter((row) => row.status === 'bloqueado');
  const accepted = preview.rows.filter((row) => row.status !== 'bloqueado');
  if (!accepted.length) {
    rememberRejected(preview, blocked, userId);
    throw new HttpError(409, 'Nenhuma linha pode ser confirmada.', preview.rows);
  }
  if (blocked.length && !onlyValid) {
    throw new HttpError(409, 'Há linhas bloqueadas. Corrija o arquivo ou confirme apenas as válidas.', preview.rows);
  }
  return transaction(() => {
    const stored = saveUpload('uploads', filename || 'etiquetas.csv', buffer);
    const results = [];
    for (const row of accepted) {
      if (usedIdentity(row.uid)) {
        rememberDuplicate(preview.fileHash, filename, row, userId);
        results.push({ ...row, status: 'bloqueado', messages: ['Etiqueta já processada'] });
        continue;
      }
      const fresh = shipmentCheck(row.productId, row.quantity, row.lot);
      if (fresh.shortages.length) throw new HttpError(409, `Estoque insuficiente para ${row.resolvedName}.`, fresh.shortages);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : today();
      const labelId = run(
        `INSERT INTO labels (uid, file_hash, source_file, code, product_name, product_id, quantity, lot_code, label_date, order_ref, movement_type, status, user_id, processed_at, message, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'expedicao', 'confirmada', ?, ?, ?, ?)`,
        [row.uid, preview.fileHash, filename, row.code, row.resolvedName, row.productId, row.quantity, row.lot || null, row.date, row.orderRef || null, userId, new Date().toISOString(), 'Movimentação confirmada', JSON.stringify({ stored, row })],
      ).id;
      const outcome = expedite({
        productId: row.productId,
        quantity: row.quantity,
        lotCode: row.lot,
        userId,
        date,
        labelId,
        channel: 'E-commerce',
        orderRef: row.orderRef || `ETQ-${labelId}`,
        notes: `Etiqueta ${filename}`,
      });
      results.push({ ...row, status: 'confirmada', expeditionId: outcome.expedition.id, impacts: outcome.impacts });
    }
    if (onlyValid) rememberRejected(preview, blocked, userId);
    return { fileHash: preview.fileHash, sourceFile: filename, results, summary: preview.summary };
  });
}

function rememberRejected(preview, rows, userId) {
  for (const row of rows) {
    const uid = `rej:${row.uid}:${Date.now()}:${row.line}`;
    const missing = row.messages.includes('Produto sem cadastro');
    const duplicate = row.messages.includes('Etiqueta já processada');
    run(
      `INSERT INTO labels (uid, file_hash, source_file, code, product_name, product_id, quantity, lot_code, label_date, order_ref, movement_type, status, user_id, processed_at, message, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'expedicao', ?, ?, ?, ?, ?)`,
      [uid, preview.fileHash, preview.sourceFile, row.code, row.productName, row.productId, row.quantity || 0, row.lot || null, row.date, row.orderRef || null, duplicate ? 'duplicada' : 'rejeitada', userId, new Date().toISOString(), row.messages.join(' · '), JSON.stringify(row)],
    );
    if (missing) logAlert({ level: 'warning', code: 'produto_sem_cadastro', message: `Etiqueta com produto sem cadastro: ${row.code || row.productName}.`, entity: 'label' });
    if (duplicate) logAlert({ level: 'warning', code: 'etiqueta_duplicada', message: `Etiqueta já processada (${row.code || row.resolvedName}). Nenhuma nova baixa foi feita.`, entity: 'label' });
  }
}

function rememberDuplicate(fileHash, filename, row, userId) {
  run(
    `INSERT INTO labels (uid, file_hash, source_file, code, product_name, product_id, quantity, lot_code, label_date, movement_type, status, user_id, processed_at, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'expedicao', 'duplicada', ?, ?, ?)`,
    [`dup:${row.uid}:${Date.now()}`, fileHash, filename, row.code, row.resolvedName, row.productId, row.quantity || 0, row.lot || null, row.date, userId, new Date().toISOString(), 'Etiqueta já processada'],
  );
  logAlert({ level: 'warning', code: 'etiqueta_duplicada', message: `Etiqueta já processada (${row.code}). Nenhuma nova baixa foi feita.`, entity: 'label' });
}

export function listLabels() {
  return q(`
    SELECT l.*, u.name AS user_name, p.sku
    FROM labels l
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN products p ON p.id = l.product_id
    ORDER BY l.id DESC
    LIMIT 400
  `);
}
