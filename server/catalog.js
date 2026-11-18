import { audit, one, q, run, saveUpload, transaction } from './db.js';
import { createUserRecord, publicUser, setPassword } from './auth.js';
import { HttpError, fold, nonNegative, now, positive, required, round, text } from './lib.js';

function searchText(parts) {
  return fold(parts.filter(Boolean).join(' '));
}

function photoFrom(payload) {
  if (!payload) return undefined;
  const mime = String(payload.mime || '');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) {
    throw new HttpError(400, 'Envie a foto em PNG, JPG ou WEBP.');
  }
  const buffer = Buffer.from(payload.base64 || '', 'base64');
  if (!buffer.length || buffer.length > 2_500_000) throw new HttpError(400, 'A foto deve ter até 2,5 MB.');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return saveUpload('uploads', payload.filename || `foto.${ext}`, buffer);
}

export function listCategories() {
  return q(`
    SELECT c.*, p.name AS parent_name
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
    ORDER BY COALESCE(p.name, c.name), c.parent_id IS NOT NULL, c.name
  `);
}

export function saveCategory({ id, name, parentId }, userId) {
  const clean = required(name, 'o nome da categoria');
  const parent = parentId ? Number(parentId) : null;
  if (parent && parent === Number(id)) throw new HttpError(400, 'A categoria não pode ser pai dela mesma.');
  if (id) {
    const old = one('SELECT * FROM categories WHERE id = ?', [Number(id)]);
    if (!old) throw new HttpError(404, 'Categoria não encontrada.');
    run('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?', [clean, parent, old.id]);
    audit(userId, 'categoria', old.id, 'editar', old, { name: clean, parentId: parent });
    return one('SELECT * FROM categories WHERE id = ?', [old.id]);
  }
  const created = run('INSERT INTO categories (name, parent_id) VALUES (?, ?)', [clean, parent]);
  audit(userId, 'categoria', created.id, 'criar', null, { name: clean });
  return one('SELECT * FROM categories WHERE id = ?', [created.id]);
}

export function removeCategory(id, userId) {
  const used = one(
    'SELECT id FROM products WHERE category_id = ? OR subcategory_id = ? LIMIT 1',
    [id, id],
  );
  if (used) throw new HttpError(409, 'Esta categoria está em uso e não pode ser excluída.');
  const child = one('SELECT id FROM categories WHERE parent_id = ? LIMIT 1', [id]);
  if (child) throw new HttpError(409, 'Remova as subcategorias antes.');
  run('DELETE FROM categories WHERE id = ?', [id]);
  audit(userId, 'categoria', id, 'excluir', { id }, null);
}

export function listSuppliers() {
  return q('SELECT * FROM suppliers ORDER BY active DESC, name');
}

export function saveSupplier(data, userId) {
  const name = required(data.name, 'o nome do fornecedor');
  const fields = [name, text(data.document), text(data.contact), text(data.phone), text(data.email), text(data.notes), data.active === false || data.active === 0 ? 0 : 1];
  if (data.id) {
    const old = one('SELECT * FROM suppliers WHERE id = ?', [Number(data.id)]);
    if (!old) throw new HttpError(404, 'Fornecedor não encontrado.');
    run(
      `UPDATE suppliers SET name=?, document=?, contact=?, phone=?, email=?, notes=?, active=? WHERE id=?`,
      [...fields, old.id],
    );
    audit(userId, 'fornecedor', old.id, 'editar', old, { name });
    return one('SELECT * FROM suppliers WHERE id = ?', [old.id]);
  }
  const created = run(
    `INSERT INTO suppliers (name, document, contact, phone, email, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    fields,
  );
  audit(userId, 'fornecedor', created.id, 'criar', null, { name });
  return one('SELECT * FROM suppliers WHERE id = ?', [created.id]);
}

export function listUsers() {
  return q('SELECT id, name, email, role, active, created_at FROM users ORDER BY active DESC, name')
    .map((row) => publicUser(row));
}

export function saveUser(data, actorId) {
  if (data.id) {
    const old = one('SELECT * FROM users WHERE id = ?', [Number(data.id)]);
    if (!old) throw new HttpError(404, 'Usuário não encontrado.');
    const role = data.role || old.role;
    const active = data.active === false || data.active === 0 ? 0 : 1;
    if (old.role === 'admin' && (role !== 'admin' || active !== 1)) {
      const others = one(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`, [old.id]);
      if (!others.n) throw new HttpError(409, 'A operação precisa de ao menos um administrador ativo.');
    }
    run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', [required(data.name, 'o nome'), role, active, old.id]);
    if (text(data.password)) setPassword(old.id, data.password);
    audit(actorId, 'usuario', old.id, 'editar', { name: old.name, role: old.role, active: old.active }, { name: data.name, role, active });
    return publicUser(one('SELECT id, name, email, role, active FROM users WHERE id = ?', [old.id]));
  }
  const id = createUserRecord(data);
  audit(actorId, 'usuario', id, 'criar', null, { name: data.name, role: data.role });
  return publicUser(one('SELECT id, name, email, role, active FROM users WHERE id = ?', [id]));
}

export function listShifts() {
  const shifts = q('SELECT * FROM shifts ORDER BY start_time');
  for (const shift of shifts) {
    shift.members = q(
      `SELECT u.id, u.name, u.role FROM shift_members sm JOIN users u ON u.id = sm.user_id WHERE sm.shift_id = ? ORDER BY u.name`,
      [shift.id],
    );
  }
  return shifts;
}

export function saveShift(data, userId) {
  const name = required(data.name, 'o nome do turno');
  const start = required(data.startTime, 'o horário inicial');
  const end = required(data.endTime, 'o horário final');
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new HttpError(400, 'Use horários no formato HH:MM.');
  const target = nonNegative(data.targetQty ?? 0, 'A meta do turno');
  const active = data.active === false || data.active === 0 ? 0 : 1;
  const id = data.id
    ? Number(data.id)
    : run(
      'INSERT INTO shifts (name, start_time, end_time, target_qty, active) VALUES (?, ?, ?, ?, ?)',
      [name, start, end, target, active],
    ).id;
  if (data.id) {
    if (!one('SELECT id FROM shifts WHERE id = ?', [id])) throw new HttpError(404, 'Turno não encontrado.');
    run('UPDATE shifts SET name=?, start_time=?, end_time=?, target_qty=?, active=? WHERE id=?', [name, start, end, target, active, id]);
  }
  if (Array.isArray(data.memberIds)) {
    run('DELETE FROM shift_members WHERE shift_id = ?', [id]);
    for (const memberId of data.memberIds) {
      run('INSERT INTO shift_members (shift_id, user_id) VALUES (?, ?)', [id, Number(memberId)]);
    }
  }
  audit(userId, 'turno', id, data.id ? 'editar' : 'criar', null, { name, start, end, target });
  return listShifts().find((shift) => shift.id === id);
}

export function listGoals() {
  return q(`
    SELECT g.*, u.name AS user_name
    FROM goals g JOIN users u ON u.id = g.user_id
    WHERE g.active = 1
    ORDER BY u.name
  `);
}

export function saveGoal(data, userId) {
  const user = one('SELECT id, name FROM users WHERE id = ?', [Number(data.userId)]);
  if (!user) throw new HttpError(404, 'Colaborador não encontrado.');
  const target = positive(data.targetQty, 'A meta');
  const existing = one(`SELECT * FROM goals WHERE user_id = ? AND period = 'dia'`, [user.id]);
  if (existing) {
    run('UPDATE goals SET target_qty = ?, active = 1 WHERE id = ?', [target, existing.id]);
    audit(userId, 'meta', existing.id, 'editar', existing, { target });
    return one('SELECT g.*, u.name AS user_name FROM goals g JOIN users u ON u.id = g.user_id WHERE g.id = ?', [existing.id]);
  }
  const created = run(`INSERT INTO goals (user_id, period, target_qty, active) VALUES (?, 'dia', ?, 1)`, [user.id, target]);
  audit(userId, 'meta', created.id, 'criar', null, { user: user.name, target });
  return one('SELECT g.*, u.name AS user_name FROM goals g JOIN users u ON u.id = g.user_id WHERE g.id = ?', [created.id]);
}

export function removeGoal(id, userId) {
  run('UPDATE goals SET active = 0 WHERE id = ?', [Number(id)]);
  audit(userId, 'meta', id, 'inativar', null, null);
}

function compositionOf(productId) {
  return {
    components: q(
      `SELECT c.component_id AS product_id, c.quantity, p.name, p.sku, p.stock_qty, p.unit
       FROM compositions c JOIN products p ON p.id = c.component_id
       WHERE c.parent_id = ? ORDER BY p.name`,
      [productId],
    ),
    materials: q(
      `SELECT pm.material_id, pm.quantity, m.name, m.code, m.stock_qty, m.unit, m.package_unit, m.package_content
       FROM product_materials pm JOIN materials m ON m.id = pm.material_id
       WHERE pm.product_id = ? ORDER BY m.name`,
      [productId],
    ),
  };
}

function presentProduct(row) {
  if (!row) return row;
  return { ...row, ...compositionOf(row.id) };
}

export function listProducts(filters = {}) {
  const term = fold(filters.q || '');
  const rows = q(`
    SELECT p.*, c.name AS category_name, s.name AS subcategory_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories s ON s.id = p.subcategory_id
    ORDER BY p.name
  `).filter((row) => {
    if (term && !String(row.searchText || '').includes(term)) return false;
    if (filters.type && row.type !== filters.type) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.categoryId && Number(row.categoryId) !== Number(filters.categoryId) && Number(row.subcategoryId) !== Number(filters.categoryId)) return false;
    if (filters.critical === '1' && !(row.minStock > 0 && row.stockQty <= row.minStock)) return false;
    return true;
  });
  return rows;
}

export function getProduct(id) {
  const row = one(`
    SELECT p.*, c.name AS category_name, s.name AS subcategory_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories s ON s.id = p.subcategory_id
    WHERE p.id = ?
  `, [Number(id)]);
  if (!row) throw new HttpError(404, 'Produto não encontrado.');
  return presentProduct(row);
}

export function findProductByCode(code, name = '') {
  const wantedCode = fold(code);
  const wantedName = fold(name);
  const items = q('SELECT * FROM products');
  if (wantedCode) {
    const byCode = items.find((item) => [item.sku, item.internalCode, item.barcode].some((value) => fold(value) === wantedCode));
    if (byCode) return byCode;
  }
  if (wantedName) return items.find((item) => fold(item.name) === wantedName) || null;
  return null;
}

function replaceComposition(productId, type, components = [], materials = []) {
  run('DELETE FROM compositions WHERE parent_id = ?', [productId]);
  run('DELETE FROM product_materials WHERE product_id = ?', [productId]);
  if (type === 'unitario') return;
  const seen = new Set();
  for (const component of components) {
    const componentId = Number(component.productId ?? component.componentId);
    const qty = positive(component.quantity, 'Quantidade do componente');
    if (componentId === productId) throw new HttpError(400, 'O produto não pode compor a si mesmo.');
    const item = one('SELECT id, name, type FROM products WHERE id = ?', [componentId]);
    if (!item) throw new HttpError(400, 'Componente não encontrado.');
    if (item.type !== 'unitario') throw new HttpError(400, `${item.name} precisa ser unitário. Kit e combo não consomem outro item composto.`);
    if (seen.has(componentId)) throw new HttpError(400, 'Há um componente repetido na composição.');
    seen.add(componentId);
    run('INSERT INTO compositions (parent_id, component_id, quantity) VALUES (?, ?, ?)', [productId, componentId, qty]);
  }
  const seenMaterial = new Set();
  for (const material of materials) {
    const materialId = Number(material.materialId);
    const qty = positive(material.quantity, 'Consumo da embalagem');
    const item = one('SELECT id FROM materials WHERE id = ?', [materialId]);
    if (!item) throw new HttpError(400, 'Material de embalagem não encontrado.');
    if (seenMaterial.has(materialId)) throw new HttpError(400, 'Há uma embalagem repetida na composição.');
    seenMaterial.add(materialId);
    run('INSERT INTO product_materials (product_id, material_id, quantity) VALUES (?, ?, ?)', [productId, materialId, qty]);
  }
}

export function saveProduct(data, userId) {
  return transaction(() => {
    const type = required(data.type, 'o tipo do produto');
    if (!['unitario', 'kit', 'combo'].includes(type)) throw new HttpError(400, 'Tipo de produto inválido.');
    const comboMode = type === 'combo' ? required(data.comboMode, 'se o combo é físico ou comercial') : null;
    if (comboMode && !['fisico', 'comercial'].includes(comboMode)) throw new HttpError(400, 'Modo do combo inválido.');
    const current = now();
    const values = {
      internalCode: required(data.internalCode, 'o código interno'),
      sku: required(data.sku, 'o SKU'),
      barcode: text(data.barcode),
      name: required(data.name, 'o nome'),
      description: text(data.description),
      brand: text(data.brand),
      categoryId: data.categoryId ? Number(data.categoryId) : null,
      subcategoryId: data.subcategoryId ? Number(data.subcategoryId) : null,
      unit: text(data.unit) || 'un',
      type,
      comboMode,
      status: data.status === 'inativo' ? 'inativo' : 'ativo',
      minStock: nonNegative(data.minStock ?? 0, 'Estoque mínimo'),
      maxStock: nonNegative(data.maxStock ?? 0, 'Estoque máximo'),
      location: text(data.location),
      notes: text(data.notes),
      costPrice: nonNegative(data.costPrice ?? 0, 'Custo'),
      salePrice: nonNegative(data.salePrice ?? 0, 'Preço'),
    };
    values.searchText = searchText([values.internalCode, values.sku, values.barcode, values.name, values.brand]);
    let id = data.id ? Number(data.id) : null;
    const old = id ? one('SELECT * FROM products WHERE id = ?', [id]) : null;
    if (id && !old) throw new HttpError(404, 'Produto não encontrado.');
    let photo = old?.photo || null;
    if (data.removePhoto) photo = null;
    if (data.photoFile) photo = photoFrom(data.photoFile);
    if (id) {
      run(
        `UPDATE products SET internal_code=?, sku=?, barcode=?, name=?, description=?, brand=?, category_id=?, subcategory_id=?, photo=?, unit=?, type=?, combo_mode=?, status=?, min_stock=?, max_stock=?, location=?, notes=?, cost_price=?, sale_price=?, search_text=?, updated_at=? WHERE id=?`,
        [values.internalCode, values.sku, values.barcode, values.name, values.description, values.brand, values.categoryId, values.subcategoryId, photo, values.unit, values.type, values.comboMode, values.status, values.minStock, values.maxStock, values.location, values.notes, values.costPrice, values.salePrice, values.searchText, current.iso, id],
      );
    } else {
      id = run(
        `INSERT INTO products (internal_code, sku, barcode, name, description, brand, category_id, subcategory_id, photo, unit, type, combo_mode, status, min_stock, max_stock, location, notes, cost_price, sale_price, stock_qty, search_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [values.internalCode, values.sku, values.barcode, values.name, values.description, values.brand, values.categoryId, values.subcategoryId, photo, values.unit, values.type, values.comboMode, values.status, values.minStock, values.maxStock, values.location, values.notes, values.costPrice, values.salePrice, values.searchText, current.iso, current.iso],
      ).id;
    }
    if (type === 'unitario' || Array.isArray(data.components) || Array.isArray(data.materials)) {
      replaceComposition(id, type, data.components || [], data.materials || []);
    }
    audit(userId, 'produto', id, old ? 'editar' : 'criar', old ? { name: old.name, sku: old.sku, status: old.status, minStock: old.minStock } : null, values);
    return getProduct(id);
  });
}

export function listMaterials() {
  return q(`
    SELECT m.*, s.name AS supplier_name
    FROM materials m
    LEFT JOIN suppliers s ON s.id = m.supplier_id
    ORDER BY m.active DESC, m.name
  `).map((row) => ({
    ...row,
    packages: row.packageContent ? round(row.stockQty / row.packageContent) : null,
  }));
}

export function saveMaterial(data, userId) {
  const name = required(data.name, 'o nome do material');
  const code = required(data.code, 'o código');
  const type = required(data.type, 'o tipo');
  const unit = required(data.unit, 'a unidade');
  const fields = [
    code, name, type, unit, text(data.packageUnit),
    data.packageContent ? positive(data.packageContent, 'O conteúdo da embalagem') : null,
    nonNegative(data.minStock ?? 0, 'Estoque mínimo'),
    nonNegative(data.maxStock ?? 0, 'Estoque máximo'),
    text(data.location),
    data.supplierId ? Number(data.supplierId) : null,
    text(data.notes),
    data.active === false || data.active === 0 ? 0 : 1,
    searchText([code, name, type]),
  ];
  if (data.id) {
    const old = one('SELECT * FROM materials WHERE id = ?', [Number(data.id)]);
    if (!old) throw new HttpError(404, 'Material não encontrado.');
    run(
      `UPDATE materials SET code=?, name=?, type=?, unit=?, package_unit=?, package_content=?, min_stock=?, max_stock=?, location=?, supplier_id=?, notes=?, active=?, search_text=? WHERE id=?`,
      [...fields, old.id],
    );
    audit(userId, 'embalagem', old.id, 'editar', { name: old.name, minStock: old.minStock }, { name, minStock: fields[6] });
    return listMaterials().find((item) => item.id === old.id);
  }
  const created = run(
    `INSERT INTO materials (code, name, type, unit, package_unit, package_content, stock_qty, min_stock, max_stock, location, supplier_id, notes, active, search_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...fields.slice(0, 6), ...fields.slice(6), now().iso],
  );
  audit(userId, 'embalagem', created.id, 'criar', null, { name, code });
  return listMaterials().find((item) => item.id === created.id);
}
