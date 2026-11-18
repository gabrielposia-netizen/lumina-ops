import { audit, one, q, run, transaction } from './db.js';
import { HttpError, at, fold, nonNegative, now, positive, required, round, same, text } from './lib.js';

function fail(status, message, details, alert) {
  const error = new HttpError(status, message, details);
  if (alert) error.alert = alert;
  return error;
}

function getItem(itemType, itemId) {
  const id = Number(itemId);
  if (!['product', 'material'].includes(itemType) || !Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'Item inválido.');
  }
  if (itemType === 'product') {
    const row = one('SELECT id, name, stock_qty, unit, type, status, sku, internal_code, combo_mode, location FROM products WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Produto não encontrado.');
    row.blocked = row.status !== 'ativo';
    row.itemType = 'product';
    return row;
  }
  const row = one('SELECT id, name, stock_qty, unit, type, active, code AS sku, location FROM materials WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Material não encontrado.');
  row.blocked = row.active !== 1;
  row.itemType = 'material';
  return row;
}

function tableOf(itemType) {
  return itemType === 'product' ? 'products' : 'materials';
}

function addToLot({ itemType, itemId, lotCode, quantity, receivedAt, expiry, supplierId, location, entryId }) {
  const code = text(lotCode) || 'S/L';
  const existing = one(
    'SELECT * FROM lots WHERE item_type = ? AND item_id = ? AND lot_code = ?',
    [itemType, itemId, code],
  );
  if (existing) {
    run('UPDATE lots SET quantity = ? WHERE id = ?', [round(existing.quantity + quantity), existing.id]);
    if (location) run('UPDATE lots SET location = ? WHERE id = ?', [location, existing.id]);
    if (expiry && !existing.expiryDate) run('UPDATE lots SET expiry_date = ? WHERE id = ?', [expiry, existing.id]);
    return code;
  }
  run(
    `INSERT INTO lots (item_type, item_id, lot_code, quantity, received_at, expiry_date, supplier_id, location, entry_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [itemType, itemId, code, round(quantity), receivedAt, expiry || null, supplierId || null, location || null, entryId || null],
  );
  return code;
}

function consumeLots(itemType, itemId, qty, preferred) {
  let remaining = round(qty);
  const slices = [];
  const lots = q(
    'SELECT * FROM lots WHERE item_type = ? AND item_id = ? AND quantity > 0.0001 ORDER BY received_at, id',
    [itemType, itemId],
  );
  const ordered = [];
  if (preferred) {
    const match = lots.find((lot) => fold(lot.lotCode) === fold(preferred));
    if (match) ordered.push(match);
  }
  for (const lot of lots) {
    if (!ordered.some((item) => item.id === lot.id)) ordered.push(lot);
  }
  for (const lot of ordered) {
    if (remaining <= 0.0001) break;
    const take = round(Math.min(lot.quantity, remaining));
    if (take <= 0) continue;
    run('UPDATE lots SET quantity = ? WHERE id = ?', [round(lot.quantity - take), lot.id]);
    slices.push({ lotCode: lot.lotCode, quantity: take });
    remaining = round(remaining - take);
  }
  if (remaining > 0.0001) slices.push({ lotCode: null, quantity: remaining });
  return slices;
}

function insertMovement(fields) {
  const id = run(
    `INSERT INTO movements (
      occurred_at, date, time, type, item_type, item_id, item_name, quantity, balance_after, lot_code,
      user_id, origin, reference, production_id, entry_id, expedition_id, inventory_id, label_id,
      notes, reversal_of, transfer_qty, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fields.when.iso, fields.when.date, fields.when.time, fields.movementType, fields.itemType, fields.itemId,
      fields.itemName, fields.quantity, fields.balanceAfter, fields.lotCode || null, fields.userId || null,
      fields.origin || null, fields.reference || null, fields.productionId || null, fields.entryId || null,
      fields.expeditionId || null, fields.inventoryId || null, fields.labelId || null, fields.notes || null,
      fields.reversalOf || null, fields.transferQty || null, fields.when.iso,
    ],
  ).id;
  return one('SELECT * FROM movements WHERE id = ?', [id]);
}

function applyStock(input) {
  const item = getItem(input.itemType, input.itemId);
  const when = input.when || now();
  if (input.movementType === 'transferencia') {
    return [insertMovement({
      ...input,
      when,
      itemName: item.name,
      quantity: 0,
      balanceAfter: item.stockQty,
      transferQty: input.transferQty,
    })];
  }
  const quantity = round(input.quantity);
  if (same(quantity, 0)) throw new HttpError(400, 'A quantidade da movimentação não pode ser zero.');
  if (quantity < 0 && item.blocked && !input.allowInactive) {
    throw fail(409, `${item.name} está inativo e não pode sair do estoque.`, null, {
      level: 'warning', code: 'movimento_invalido', message: `Saída bloqueada: ${item.name} está inativo.`, entity: input.itemType, entityId: item.id,
    });
  }
  const next = round(item.stockQty + quantity);
  if (next < -0.0001) {
    throw fail(409, `Estoque insuficiente de ${item.name}. Disponível: ${item.stockQty} ${item.unit}. Necessário: ${round(Math.abs(quantity))} ${item.unit}.`, null, {
      level: 'danger', code: 'movimento_invalido', message: `Movimentação inválida em ${item.name}: estoque insuficiente.`, entity: input.itemType, entityId: item.id,
    });
  }
  run(`UPDATE ${tableOf(input.itemType)} SET stock_qty = ? WHERE id = ?`, [next, item.id]);
  const created = [];
  if (quantity > 0) {
    const lotCode = addToLot({
      itemType: input.itemType,
      itemId: item.id,
      lotCode: input.lotCode,
      quantity,
      receivedAt: when.iso,
      expiry: input.expiry,
      supplierId: input.supplierId,
      location: input.location,
      entryId: input.entryId,
    });
    created.push(insertMovement({ ...input, when, itemName: item.name, quantity, balanceAfter: next, lotCode }));
    return created;
  }
  const slices = consumeLots(input.itemType, item.id, Math.abs(quantity), input.lotCode);
  let running = item.stockQty;
  for (const slice of slices) {
    running = round(running - slice.quantity);
    created.push(insertMovement({
      ...input,
      when,
      itemName: item.name,
      quantity: round(-slice.quantity),
      balanceAfter: running,
      lotCode: slice.lotCode,
    }));
  }
  return created;
}

function recipe(productId) {
  const components = q(
    `SELECT c.quantity AS per_unit, p.id, p.name, p.stock_qty, p.unit
     FROM compositions c JOIN products p ON p.id = c.component_id WHERE c.parent_id = ?`,
    [productId],
  ).map((row) => ({ ...row, itemType: 'product' }));
  const materials = q(
    `SELECT pm.quantity AS per_unit, m.id, m.name, m.stock_qty, m.unit
     FROM product_materials pm JOIN materials m ON m.id = pm.material_id WHERE pm.product_id = ?`,
    [productId],
  ).map((row) => ({ ...row, itemType: 'material' }));
  return { components, materials };
}

export function shipmentCheck(productId, quantity, lotCode) {
  const product = one('SELECT * FROM products WHERE id = ?', [Number(productId)]);
  if (!product) return { shortages: [{ name: 'Produto', have: 0, need: quantity, unit: 'un' }], lot: null, product: null };
  const commercial = product.type === 'combo' && product.comboMode === 'comercial';
  if (commercial) {
    const { components, materials } = recipe(product.id);
    return {
      product,
      shortages: ensureAvailable([...components, ...materials], quantity),
      lot: { state: 'na', message: 'Combo comercial baixa os componentes, não um lote do combo.' },
    };
  }
  const shortages = product.stockQty + 0.0001 < quantity
    ? [{ name: product.name, have: product.stockQty, need: quantity, unit: product.unit }]
    : [];
  let lot = { state: 'na', message: 'Sem lote na etiqueta' };
  if (lotCode) {
    const found = one(
      `SELECT quantity FROM lots WHERE item_type = 'product' AND item_id = ? AND lot_code = ? COLLATE NOCASE`,
      [product.id, lotCode],
    );
    if (!found) lot = { state: 'warn', message: 'Lote não cadastrado. A baixa seguirá o lote mais antigo.' };
    else if (found.quantity + 0.0001 < quantity) lot = { state: 'warn', message: `Lote ${lotCode} tem ${found.quantity}. O restante sairá de outros lotes.` };
    else lot = { state: 'ok', message: 'Lote identificado' };
  }
  return { shortages, lot, product };
}

function ensureAvailable(lines, multiplier) {
  const shortages = [];
  for (const line of lines) {
    const need = round(line.perUnit * multiplier);
    if (line.stockQty + 0.0001 < need) {
      shortages.push({ name: line.name, have: line.stockQty, need, unit: line.unit });
    }
  }
  return shortages;
}

function nextOrderCode(date) {
  const prefix = `OP-${date.replaceAll('-', '')}-`;
  const row = one('SELECT order_code FROM productions WHERE order_code LIKE ? ORDER BY order_code DESC LIMIT 1', [`${prefix}%`]);
  const current = row ? Number(String(row.orderCode).slice(prefix.length)) : 0;
  return `${prefix}${String(current + 1).padStart(3, '0')}`;
}

export function receive(input) {
  return transaction(() => {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new HttpError(400, 'Inclua ao menos um item recebido.');
    const when = at(input.date, input.time);
    const supplierId = input.supplierId ? Number(input.supplierId) : null;
    if (supplierId && !one('SELECT id FROM suppliers WHERE id = ?', [supplierId])) throw new HttpError(404, 'Fornecedor não encontrado.');
    const entryId = run(
      `INSERT INTO entries (date, time, supplier_id, invoice, user_id, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmada', ?)`,
      [when.date, when.time, supplierId, text(input.invoice), input.userId, text(input.notes), when.iso],
    ).id;
    const impacts = [];
    for (const line of items) {
      const itemType = line.itemType === 'material' ? 'material' : 'product';
      const item = getItem(itemType, line.itemId);
      const quantity = positive(line.quantity, 'Quantidade recebida');
      run(
        `INSERT INTO entry_items (entry_id, item_type, item_id, item_name, quantity, lot_code, expiry_date, location)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [entryId, itemType, item.id, item.name, quantity, text(line.lotCode), text(line.expiryDate), text(line.location)],
      );
      impacts.push(...applyStock({
        itemType, itemId: item.id, quantity, movementType: 'entrada', origin: 'recebimento', userId: input.userId,
        when, lotCode: text(line.lotCode), expiry: text(line.expiryDate), supplierId, location: text(line.location),
        reference: text(input.invoice), entryId, notes: text(input.notes),
      }));
    }
    audit(input.userId, 'entrada', entryId, 'confirmar', null, { invoice: text(input.invoice), items: items.length });
    return { entry: getEntry(entryId), impacts };
  });
}

export function produce(input) {
  return transaction(() => {
    const product = one('SELECT * FROM products WHERE id = ?', [Number(input.productId)]);
    if (!product) throw new HttpError(404, 'Produto não encontrado.');
    if (product.status !== 'ativo') throw new HttpError(409, 'Produto inativo não pode ser montado.');
    if (product.type === 'unitario') throw new HttpError(400, 'Produto unitário não possui montagem. Lance o recebimento para entrar no estoque.');
    if (product.type === 'combo' && product.comboMode === 'comercial') {
      throw new HttpError(400, 'Combo comercial não é montado fisicamente. Os componentes baixam na expedição.');
    }
    const quantity = positive(input.quantity, 'Quantidade produzida');
    const { components, materials } = recipe(product.id);
    if (!components.length && !materials.length) throw new HttpError(400, 'Cadastre a composição do produto antes de produzir.');
    const shortages = ensureAvailable([...components, ...materials], quantity);
    if (shortages.length) {
      throw fail(409, 'Não há estoque para montar essa quantidade.', shortages, {
        level: 'danger', code: 'movimento_invalido', message: `Montagem bloqueada de ${quantity} ${product.name}: estoque insuficiente.`, entity: 'product', entityId: product.id,
      });
    }
    const user = one('SELECT id FROM users WHERE id = ? AND active = 1', [Number(input.userId)]);
    if (!user) throw new HttpError(404, 'Colaborador não encontrado.');
    const when = at(input.date, input.time);
    const orderCode = text(input.orderCode) || nextOrderCode(when.date);
    if (one('SELECT id FROM productions WHERE order_code = ?', [orderCode])) throw new HttpError(409, 'Já existe uma ordem de produção com esse código.');
    const lotCode = text(input.lotCode) || `L${when.date.replaceAll('-', '')}`;
    const shiftId = input.shiftId ? Number(input.shiftId) : null;
    const productionId = run(
      `INSERT INTO productions (order_code, product_id, quantity, user_id, shift_id, date, time, lot_code, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', ?)`,
      [orderCode, product.id, quantity, user.id, shiftId, when.date, when.time, lotCode, text(input.notes), when.iso],
    ).id;
    const impacts = [];
    impacts.push(...applyStock({
      itemType: 'product', itemId: product.id, quantity, movementType: 'producao', origin: 'producao',
      userId: input.userId, when, lotCode, reference: orderCode, productionId, notes: text(input.notes),
    }));
    for (const line of [...components, ...materials]) {
      impacts.push(...applyStock({
        itemType: line.itemType, itemId: line.id, quantity: round(-line.perUnit * quantity), movementType: 'montagem', origin: 'producao',
        userId: input.userId, when, reference: orderCode, productionId,
        notes: `Consumo automático de ${orderCode}`,
      }));
    }
    audit(input.userId, 'producao', productionId, 'confirmar', null, { orderCode, quantity, product: product.name });
    return { production: getProduction(productionId), impacts };
  });
}

export function expedite(input) {
  return transaction(() => {
    const product = one('SELECT * FROM products WHERE id = ?', [Number(input.productId)]);
    if (!product) throw new HttpError(404, 'Produto não encontrado.');
    if (product.status !== 'ativo') throw new HttpError(409, 'Produto inativo não pode ser expedido.');
    const quantity = positive(input.quantity, 'Quantidade');
    const when = at(input.date, input.time);
    const commercial = product.type === 'combo' && product.comboMode === 'comercial';
    const { components, materials } = commercial ? recipe(product.id) : { components: [], materials: [] };
    if (commercial && !components.length) throw new HttpError(400, 'Combo comercial sem composição.');
    if (commercial) {
      const shortages = ensureAvailable([...components, ...materials], quantity);
      if (shortages.length) {
        throw fail(409, 'Não há componentes para expedir esse combo.', shortages, {
          level: 'danger', code: 'movimento_invalido', message: `Expedição bloqueada de ${quantity} ${product.name}.`, entity: 'product', entityId: product.id,
        });
      }
    }
    const expeditionId = run(
      `INSERT INTO expeditions (date, time, product_id, quantity, lot_code, user_id, label_id, channel, order_ref, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', ?)`,
      [when.date, when.time, product.id, quantity, text(input.lotCode), input.userId, input.labelId || null, text(input.channel), text(input.orderRef), text(input.notes), when.iso],
    ).id;
    const origin = input.labelId ? 'etiqueta' : 'expedicao';
    const impacts = [];
    if (commercial) {
      for (const line of components) {
        impacts.push(...applyStock({
          itemType: 'product', itemId: line.id, quantity: round(-line.perUnit * quantity), movementType: 'expedicao',
          origin, userId: input.userId, when, reference: text(input.orderRef), expeditionId, labelId: input.labelId || null,
          notes: `Baixa do combo ${product.name}`,
        }));
      }
      for (const line of materials) {
        impacts.push(...applyStock({
          itemType: 'material', itemId: line.id, quantity: round(-line.perUnit * quantity), movementType: 'expedicao',
          origin, userId: input.userId, when, reference: text(input.orderRef), expeditionId, labelId: input.labelId || null,
          notes: `Embalagem do combo ${product.name}`,
        }));
      }
    } else {
      impacts.push(...applyStock({
        itemType: 'product', itemId: product.id, quantity: round(-quantity), movementType: 'expedicao', origin,
        userId: input.userId, when, lotCode: text(input.lotCode), reference: text(input.orderRef), expeditionId,
        labelId: input.labelId || null, notes: text(input.notes),
      }));
    }
    audit(input.userId, 'expedicao', expeditionId, 'confirmar', null, { product: product.name, quantity });
    return { expedition: getExpedition(expeditionId), impacts };
  });
}

export function transfer(input) {
  return transaction(() => {
    const itemType = input.itemType === 'material' ? 'material' : 'product';
    const item = getItem(itemType, input.itemId);
    const quantity = positive(input.quantity, 'Quantidade transferida');
    if (item.stockQty + 0.0001 < quantity) {
      throw fail(409, `Estoque insuficiente de ${item.name} para transferir.`, null, {
        level: 'danger', code: 'movimento_invalido', message: `Transferência inválida de ${item.name}.`, entity: itemType, entityId: item.id,
      });
    }
    const fromLocation = required(input.fromLocation, 'a localização de origem');
    const toLocation = required(input.toLocation, 'a localização de destino');
    const when = at(input.date, input.time);
    if (text(input.lotCode)) {
      run(
        'UPDATE lots SET location = ? WHERE item_type = ? AND item_id = ? AND lot_code = ?',
        [toLocation, itemType, item.id, text(input.lotCode)],
      );
    } else {
      run(`UPDATE ${tableOf(itemType)} SET location = ? WHERE id = ?`, [toLocation, item.id]);
    }
    const impacts = applyStock({
      itemType, itemId: item.id, quantity: 0, movementType: 'transferencia', origin: 'manual', userId: input.userId,
      when, lotCode: text(input.lotCode), transferQty: quantity, reference: `${fromLocation} → ${toLocation}`,
      notes: `De ${fromLocation} para ${toLocation}`,
    });
    audit(input.userId, 'transferencia', item.id, 'transferir', { location: fromLocation }, { location: toLocation, quantity });
    return { impacts };
  });
}

export function reverseDocument(kind, id, userId, reason) {
  return transaction(() => {
    const column = { production: 'production_id', expedition: 'expedition_id', entry: 'entry_id' }[kind];
    if (!column) throw new HttpError(400, 'Estorno inválido.');
    const table = { production: 'productions', expedition: 'expeditions', entry: 'entries' }[kind];
    const document = one(`SELECT * FROM ${table} WHERE id = ?`, [Number(id)]);
    if (!document) throw new HttpError(404, 'Documento não encontrado.');
    if (document.status === 'estornada') throw new HttpError(409, 'Este lançamento já foi estornado.');
    const movements = q(
      `SELECT * FROM movements WHERE ${column} = ? AND reversal_of IS NULL AND reversed_at IS NULL ORDER BY id DESC`,
      [document.id],
    );
    if (!movements.length) throw new HttpError(409, 'Não há movimentação ativa para estornar.');
    const when = now();
    const impacts = [];
    for (const movement of movements) {
      impacts.push(...applyStock({
        itemType: movement.itemType,
        itemId: movement.itemId,
        quantity: round(-movement.quantity),
        movementType: 'estorno',
        origin: 'estorno',
        userId,
        when,
        lotCode: movement.lotCode,
        reference: movement.reference,
        productionId: movement.productionId,
        entryId: movement.entryId,
        expeditionId: movement.expeditionId,
        labelId: movement.labelId,
        notes: text(reason) || `Estorno do movimento ${movement.id}`,
        reversalOf: movement.id,
        allowInactive: true,
      }));
      run('UPDATE movements SET reversed_at = ? WHERE id = ?', [when.iso, movement.id]);
    }
    run(`UPDATE ${table} SET status = 'estornada' WHERE id = ?`, [document.id]);
    if (kind === 'expedition' && document.labelId) {
      run(`UPDATE labels SET status = 'estornada', message = ? WHERE id = ?`, ['Expedição estornada. A etiqueta não pode ser processada de novo.', document.labelId]);
    }
    audit(userId, kind, document.id, 'estornar', { status: 'confirmada' }, { status: 'estornada', reason: text(reason) });
    return { impacts };
  });
}

export function registerInventory(input) {
  return transaction(() => {
    const counts = Array.isArray(input.counts) ? input.counts : [];
    if (!counts.length) throw new HttpError(400, 'Inclua ao menos um item na contagem.');
    const when = at(input.date, input.time);
    const inventoryId = run(
      `INSERT INTO inventories (date, time, user_id, status, notes, created_at) VALUES (?, ?, ?, 'fechado', ?, ?)`,
      [when.date, when.time, input.userId, text(input.notes), when.iso],
    ).id;
    const impacts = [];
    const seen = new Set();
    for (const count of counts) {
      const itemType = count.itemType === 'material' ? 'material' : 'product';
      const item = getItem(itemType, count.itemId);
      const key = `${itemType}:${item.id}`;
      if (seen.has(key)) throw new HttpError(400, `${item.name} foi contado mais de uma vez.`);
      seen.add(key);
      const physical = nonNegative(count.physicalQty, `Quantidade física de ${item.name}`);
      const difference = round(physical - item.stockQty);
      if (!same(difference, 0) && !text(count.justification)) {
        throw new HttpError(400, `Informe a justificativa do ajuste de ${item.name}.`);
      }
      run(
        `INSERT INTO inventory_counts (inventory_id, item_type, item_id, item_name, system_qty, physical_qty, difference, justification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [inventoryId, itemType, item.id, item.name, item.stockQty, physical, difference, text(count.justification)],
      );
      if (!same(difference, 0)) {
        impacts.push(...applyStock({
          itemType, itemId: item.id, quantity: difference, movementType: 'inventario', origin: 'inventario',
          userId: input.userId, when, inventoryId, lotCode: difference > 0 ? `INV-${inventoryId}` : null,
          reference: `INV-${inventoryId}`, notes: text(count.justification), allowInactive: true,
        }));
      }
    }
    audit(input.userId, 'inventario', inventoryId, 'fechar', null, { items: counts.length });
    return { inventory: getInventory(inventoryId), impacts };
  });
}

export function listMovements(filters = {}) {
  const rows = q(`
    SELECT m.*, u.name AS user_name
    FROM movements m
    LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.id DESC
    LIMIT 2000
  `);
  return rows.filter((row) => {
    if (filters.from && row.date < filters.from) return false;
    if (filters.to && row.date > filters.to) return false;
    if (filters.type && row.type !== filters.type) return false;
    if (filters.userId && Number(row.userId) !== Number(filters.userId)) return false;
    if (filters.lot && fold(row.lotCode) !== fold(filters.lot)) return false;
    if (filters.origin && row.origin !== filters.origin) return false;
    if (filters.reference && !fold(row.reference).includes(fold(filters.reference))) return false;
    if (filters.q && !fold(`${row.itemName} ${row.reference || ''} ${row.notes || ''}`).includes(fold(filters.q))) return false;
    return true;
  }).slice(0, Number(filters.limit) || 400);
}

export function listLots(filters = {}) {
  const productLots = q(`
    SELECT l.*, p.name AS item_name, p.unit, p.sku
    FROM lots l JOIN products p ON p.id = l.item_id
    WHERE l.item_type = 'product'
    ORDER BY l.expiry_date IS NULL, l.expiry_date, p.name
  `).map((row) => ({ ...row, itemType: 'product' }));
  const materialLots = q(`
    SELECT l.*, m.name AS item_name, m.unit, m.code AS sku
    FROM lots l JOIN materials m ON m.id = l.item_id
    WHERE l.item_type = 'material'
    ORDER BY m.name
  `).map((row) => ({ ...row, itemType: 'material' }));
  return [...productLots, ...materialLots].filter((row) => {
    if (filters.q && !fold(`${row.itemName} ${row.lotCode} ${row.sku}`).includes(fold(filters.q))) return false;
    if (filters.onlyPositive === '1' && row.quantity <= 0) return false;
    return true;
  });
}

export function listEntries() {
  const entries = q(`
    SELECT e.*, s.name AS supplier_name, u.name AS user_name
    FROM entries e
    LEFT JOIN suppliers s ON s.id = e.supplier_id
    JOIN users u ON u.id = e.user_id
    ORDER BY e.id DESC
    LIMIT 300
  `);
  for (const entry of entries) {
    entry.items = q('SELECT * FROM entry_items WHERE entry_id = ?', [entry.id]);
  }
  return entries;
}

export function getEntry(id) {
  const entry = one(`
    SELECT e.*, s.name AS supplier_name, u.name AS user_name
    FROM entries e
    LEFT JOIN suppliers s ON s.id = e.supplier_id
    JOIN users u ON u.id = e.user_id
    WHERE e.id = ?
  `, [Number(id)]);
  if (!entry) throw new HttpError(404, 'Entrada não encontrada.');
  entry.items = q('SELECT * FROM entry_items WHERE entry_id = ?', [entry.id]);
  return entry;
}

export function listProductions(filters = {}) {
  const rows = q(`
    SELECT p.*, pr.name AS product_name, pr.sku, u.name AS user_name, s.name AS shift_name
    FROM productions p
    JOIN products pr ON pr.id = p.product_id
    JOIN users u ON u.id = p.user_id
    LEFT JOIN shifts s ON s.id = p.shift_id
    ORDER BY p.date DESC, p.time DESC, p.id DESC
    LIMIT 500
  `);
  return rows.filter((row) => {
    if (filters.from && row.date < filters.from) return false;
    if (filters.to && row.date > filters.to) return false;
    if (filters.userId && Number(row.userId) !== Number(filters.userId)) return false;
    return true;
  });
}

export function getProduction(id) {
  const row = one(`
    SELECT p.*, pr.name AS product_name, pr.sku, u.name AS user_name, s.name AS shift_name
    FROM productions p
    JOIN products pr ON pr.id = p.product_id
    JOIN users u ON u.id = p.user_id
    LEFT JOIN shifts s ON s.id = p.shift_id
    WHERE p.id = ?
  `, [Number(id)]);
  if (!row) throw new HttpError(404, 'Produção não encontrada.');
  row.impacts = q('SELECT * FROM movements WHERE production_id = ? ORDER BY id', [row.id]);
  return row;
}

export function listExpeditions() {
  return q(`
    SELECT e.*, p.name AS product_name, p.sku, p.type AS product_type, u.name AS user_name
    FROM expeditions e
    JOIN products p ON p.id = e.product_id
    JOIN users u ON u.id = e.user_id
    ORDER BY e.id DESC
    LIMIT 400
  `);
}

export function getExpedition(id) {
  const row = one(`
    SELECT e.*, p.name AS product_name, p.sku, u.name AS user_name
    FROM expeditions e
    JOIN products p ON p.id = e.product_id
    JOIN users u ON u.id = e.user_id
    WHERE e.id = ?
  `, [Number(id)]);
  if (!row) throw new HttpError(404, 'Expedição não encontrada.');
  row.impacts = q('SELECT * FROM movements WHERE expedition_id = ? ORDER BY id', [row.id]);
  return row;
}

export function listInventories() {
  const rows = q(`
    SELECT i.*, u.name AS user_name
    FROM inventories i JOIN users u ON u.id = i.user_id
    ORDER BY i.id DESC LIMIT 100
  `);
  for (const row of rows) {
    const diff = one('SELECT COUNT(*) AS n FROM inventory_counts WHERE inventory_id = ? AND ABS(difference) > 0.0001', [row.id]);
    row.divergences = diff?.n || 0;
  }
  return rows;
}

export function getInventory(id) {
  const row = one(`
    SELECT i.*, u.name AS user_name FROM inventories i JOIN users u ON u.id = i.user_id WHERE i.id = ?
  `, [Number(id)]);
  if (!row) throw new HttpError(404, 'Inventário não encontrado.');
  row.counts = q('SELECT * FROM inventory_counts WHERE inventory_id = ? ORDER BY ABS(difference) DESC, item_name', [row.id]);
  return row;
}

export function countSheet() {
  const products = q(`SELECT id, name, sku AS code, unit, stock_qty, 'product' AS item_type, type, location FROM products WHERE status = 'ativo' ORDER BY name`);
  const materials = q(`SELECT id, name, code, unit, stock_qty, 'material' AS item_type, type, location FROM materials WHERE active = 1 ORDER BY name`);
  return [...products, ...materials];
}

