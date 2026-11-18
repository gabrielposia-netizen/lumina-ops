import { audit, one, q, run } from './db.js';
import { addDays, fold, monthStart, round, shiftHours, sum, today } from './lib.js';
import { labelSecurity } from './unify.js';

function n(value, digits = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function nFlex(value) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function daysBetween(from, to) {
  const days = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    if (days.length > 400) break;
  }
  return days;
}

function outbound(itemType, itemId, from, to) {
  const row = one(
    `SELECT COALESCE(SUM(CASE WHEN quantity < 0 THEN -quantity ELSE 0 END), 0) AS qty
     FROM movements
     WHERE item_type = ? AND item_id = ? AND date >= ? AND date <= ?
       AND reversed_at IS NULL AND reversal_of IS NULL
       AND type IN ('montagem', 'expedicao', 'saida')`,
    [itemType, itemId, from, to],
  );
  return row?.qty || 0;
}

export function capacityOf(product) {
  const components = q(
    `SELECT p.name, p.stock_qty, p.unit, c.quantity AS per_unit, 'componente' AS kind
     FROM compositions c JOIN products p ON p.id = c.component_id WHERE c.parent_id = ?`,
    [product.id],
  );
  const materials = q(
    `SELECT m.name, m.stock_qty, m.unit, pm.quantity AS per_unit, 'embalagem' AS kind
     FROM product_materials pm JOIN materials m ON m.id = pm.material_id WHERE pm.product_id = ?`,
    [product.id],
  );
  const limits = [...components, ...materials].map((line) => ({
    name: line.name,
    kind: line.kind,
    stock: line.stockQty,
    unit: line.unit,
    perUnit: line.perUnit,
    can: line.perUnit > 0 ? Math.floor((line.stockQty + 1e-9) / line.perUnit) : 0,
  })).sort((a, b) => a.can - b.can || a.name.localeCompare(b.name, 'pt-BR'));
  const bottleneck = limits[0] || null;
  if (bottleneck) limits.forEach((line) => { line.limiting = line.name === bottleneck.name && line.can === bottleneck.can; });
  const max = bottleneck ? bottleneck.can : 0;
  const sentence = bottleneck
    ? `Você possui componentes para produzir ${n(max)} kits. O gargalo atual é ${bottleneck.name}.`
    : `${product.name} ainda não tem composição cadastrada.`;
  return { productId: product.id, productName: product.name, sku: product.sku, type: product.type, max, bottleneck, limits, sentence };
}

export function capacities() {
  const products = q(`SELECT * FROM products WHERE status = 'ativo' AND (type = 'kit' OR (type = 'combo' AND combo_mode = 'fisico')) ORDER BY stock_qty DESC, name`);
  return products.map(capacityOf);
}

function coverOf(item, itemType) {
  const from = addDays(today(), -13);
  const consumed = outbound(itemType, item.id, from, today());
  const daily = consumed / 14;
  const days = daily > 0 ? item.stockQty / daily : null;
  let status = 'ok';
  if (item.minStock > 0 && item.stockQty <= item.minStock) status = 'critico';
  else if (days != null && days < 7) status = 'atencao';
  else if (item.minStock > 0 && item.stockQty <= item.minStock * 1.25) status = 'atencao';
  return { daily: round(daily), days: days == null ? null : round(days), consumed: round(consumed), status };
}

export function getAlerts() {
  const alerts = [];
  const products = q(`SELECT * FROM products WHERE status = 'ativo'`);
  const materials = q(`SELECT * FROM materials WHERE active = 1`);
  const componentIds = new Set(q('SELECT DISTINCT component_id AS id FROM compositions').map((row) => row.id));
  for (const item of products) {
    if (item.minStock > 0 && item.stockQty <= item.minStock) {
      const component = componentIds.has(item.id);
      alerts.push({
        level: 'danger',
        code: component ? 'falta_componente' : 'estoque_minimo',
        title: component ? 'Falta de produto componente' : 'Estoque abaixo do mínimo',
        message: `${item.name}: ${nFlex(item.stockQty)} ${item.unit} (mínimo ${nFlex(item.minStock)}).`,
        href: '#/estoque',
      });
    } else if (item.minStock > 0 && item.stockQty <= item.minStock * 1.25) {
      alerts.push({
        level: 'warning',
        code: 'estoque_proximo',
        title: 'Estoque próximo do mínimo',
        message: `${item.name}: ${nFlex(item.stockQty)} ${item.unit}. O mínimo é ${nFlex(item.minStock)}.`,
        href: '#/estoque',
      });
    }
  }
  for (const item of materials) {
    if (item.minStock > 0 && item.stockQty <= item.minStock) {
      alerts.push({
        level: 'danger',
        code: 'falta_embalagem',
        title: 'Falta de embalagem',
        message: `${item.name}: ${nFlex(item.stockQty)} ${item.unit} (mínimo ${nFlex(item.minStock)}).`,
        href: '#/embalagens',
      });
    } else if (item.minStock > 0 && item.stockQty <= item.minStock * 1.25) {
      alerts.push({
        level: 'warning',
        code: 'estoque_proximo',
        title: 'Embalagem próxima do mínimo',
        message: `${item.name}: ${nFlex(item.stockQty)} ${item.unit}.`,
        href: '#/embalagens',
      });
    }
  }
  const yesterday = addDays(today(), -1);
  const goals = q(`SELECT u.id AS user_id, u.name AS user_name, g.target_qty FROM goals g JOIN users u ON u.id = g.user_id WHERE g.active = 1`);
  const behind = [];
  for (const goal of goals) {
    const made = one(`SELECT COALESCE(SUM(quantity), 0) AS qty FROM productions WHERE user_id = ? AND date = ? AND status = 'confirmada'`, [goal.userId, yesterday])?.qty || 0;
    if (made + 0.0001 < goal.targetQty) behind.push(`${goal.userName} (${nFlex(made)} de ${nFlex(goal.targetQty)})`);
  }
  if (behind.length) {
    alerts.push({
      level: 'warning',
      code: 'abaixo_meta',
      title: 'Produção abaixo da meta',
      message: `Ontem ficaram abaixo da meta: ${behind.join(', ')}.`,
      href: '#/produtividade',
    });
  }
  const spikes = [];
  for (const item of [...materials, ...products.filter((item) => componentIds.has(item.id))]) {
    const cover = coverOf(item, item.unit ? (materials.includes(item) ? 'material' : 'product') : 'product');
    const todayOut = outbound(materials.includes(item) ? 'material' : 'product', item.id, today(), today());
    if (cover.daily > 0 && todayOut > cover.daily * 2 && todayOut >= 20) spikes.push(item.name);
  }
  if (spikes.length) {
    alerts.push({
      level: 'warning',
      code: 'consumo_fora_padrao',
      title: 'Consumo fora do padrão',
      message: `O consumo de hoje está acima do dobro da média em: ${spikes.slice(0, 4).join(', ')}.`,
      href: '#/embalagens',
    });
  }
  const soon = addDays(today(), 90);
  const expiring = q(
    `SELECT l.lot_code, l.expiry_date, l.quantity, p.name AS item_name
     FROM lots l JOIN products p ON p.id = l.item_id
     WHERE l.item_type = 'product' AND l.quantity > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= ?
     ORDER BY l.expiry_date LIMIT 6`,
    [soon],
  );
  for (const lot of expiring) {
    alerts.push({
      level: 'warning',
      code: 'validade',
      title: 'Validade próxima',
      message: `${lot.itemName}, lote ${lot.lotCode}, vence em ${lot.expiryDate.split('-').reverse().join('/')}.`,
      href: '#/estoque',
    });
  }
  const divergence = one(
    `SELECT i.id, i.date, COUNT(*) AS n
     FROM inventory_counts c JOIN inventories i ON i.id = c.inventory_id
     WHERE ABS(c.difference) > 0.0001 AND i.date >= ?
     GROUP BY i.id ORDER BY i.id DESC LIMIT 1`,
    [addDays(today(), -30)],
  );
  if (divergence) {
    alerts.push({
      level: 'warning',
      code: 'divergencia',
      title: 'Divergência de estoque',
      message: `Inventário de ${divergence.date.split('-').reverse().join('/')} registrou ${divergence.n} diferença(s) ajustada(s).`,
      href: '#/inventario',
    });
  }
  const events = q(
    `SELECT * FROM alerts_log WHERE resolved = 0 AND created_at >= ? ORDER BY id DESC LIMIT 12`,
    [`${addDays(today(), -14)}T00:00:00`],
  );
  const security = labelSecurity();
  if (security.blocked.length) {
    alerts.push({
      level: 'warning',
      code: 'etiqueta_duplicada_impressao',
      title: 'Etiqueta duplicada',
      message: `A trava impediu reimprimir ${security.blocked[0].sourceFile}. ${countLabel(security.blocked.length, 'tentativa segurada', 'tentativas seguradas')} para não perder etiqueta.`,
      href: '#/etiquetas',
    });
  }
  for (const pair of security.pairs.slice(0, 3)) {
    alerts.push({
      level: 'warning',
      code: 'etiqueta_parecida',
      title: 'Possível duplicidade',
      message: pair.kind === 'pedido'
        ? `${pair.left} e ${pair.right} parecem o mesmo pedido (${pair.shared}).`
        : `${pair.left} e ${pair.right} têm o mesmo nome e o mesmo tamanho.`,
      href: '#/etiquetas',
    });
  }
  for (const event of events) {
    if (event.code === 'etiqueta_duplicada_impressao' || event.code === 'reimpressao_autorizada' || event.code === 'etiqueta_transportadora') continue;
    alerts.push({
      id: event.id,
      level: event.level === 'danger' ? 'danger' : 'warning',
      code: event.code,
      title: event.code.replaceAll('_', ' '),
      message: event.message,
      href: '#/etiquetas',
      event: true,
    });
  }
  return alerts;
}

export function resolveAlert(id, userId) {
  run('UPDATE alerts_log SET resolved = 1 WHERE id = ?', [Number(id)]);
  audit(userId, 'alerta', id, 'resolver', null, { resolved: true });
}

function productionSeries(days) {
  const rows = q(
    `SELECT date, COALESCE(SUM(quantity), 0) AS qty FROM productions WHERE status = 'confirmada' AND date >= ? GROUP BY date`,
    [days[0]],
  );
  const map = new Map(rows.map((row) => [row.date, row.qty]));
  return days.map((date) => ({ date, qty: map.get(date) || 0 }));
}

export function overview(user) {
  const day = today();
  const products = q('SELECT * FROM products');
  const materials = q('SELECT * FROM materials WHERE active = 1');
  const active = products.filter((item) => item.status === 'ativo');
  const sensitive = ['admin', 'gestor', 'consulta'].includes(user?.role);
  const received = one(`SELECT COALESCE(SUM(ei.quantity), 0) AS qty FROM entry_items ei JOIN entries e ON e.id = ei.entry_id WHERE e.date = ? AND e.status = 'confirmada' AND ei.item_type = 'product'`, [day])?.qty || 0;
  const produced = one(`SELECT COALESCE(SUM(quantity), 0) AS qty FROM productions WHERE date = ? AND status = 'confirmada'`, [day])?.qty || 0;
  const shipped = one(`SELECT COALESCE(SUM(quantity), 0) AS qty FROM expeditions WHERE date = ? AND status = 'confirmada'`, [day])?.qty || 0;
  const labels = one(`SELECT COUNT(*) AS qty FROM labels WHERE status = 'confirmada' AND processed_at >= ?`, [`${day}T00:00:00`])?.qty || 0;
  const goals = q('SELECT target_qty FROM goals WHERE active = 1');
  const goalSum = sum(goals.map((goal) => goal.targetQty));
  const efficiency = goalSum > 0 ? produced / goalSum : null;
  const boxes = materials.filter((item) => fold(item.type) === 'caixa');
  const critical = active.filter((item) => item.minStock > 0 && item.stockQty <= item.minStock)
    .concat(materials.filter((item) => item.minStock > 0 && item.stockQty <= item.minStock));
  const caps = capacities();
  const main = caps[0];
  const days = daysBetween(addDays(day, -14), day);
  const ranking = q(
    `SELECT u.name, COALESCE(SUM(p.quantity), 0) AS qty
     FROM productions p JOIN users u ON u.id = p.user_id
     WHERE p.date = ? AND p.status = 'confirmada'
     GROUP BY u.id ORDER BY qty DESC`,
    [day],
  );
  return {
    today: day,
    kpis: {
      stockUnits: sum(active.map((item) => item.stockQty)),
      stockValue: sensitive ? sum(active.map((item) => item.stockQty * (item.costPrice || 0))) : null,
      products: active.length,
      kitsStock: sum(active.filter((item) => item.type === 'kit').map((item) => item.stockQty)),
      receivedToday: received,
      productionToday: produced,
      expeditionsToday: shipped,
      criticalCount: critical.length,
      efficiency,
      goalToday: goalSum,
      boxes: sum(boxes.map((item) => item.stockQty)),
      boxLines: boxes.map((item) => ({ name: item.name, stock: item.stockQty })),
      materials: materials.length,
      materialsCritical: materials.filter((item) => item.minStock > 0 && item.stockQty <= item.minStock).length,
    },
    insight: main ? { text: `${main.productName}: ${main.sentence}`, tone: main.bottleneck && main.max < 1000 ? 'warning' : 'ok', productId: main.productId } : null,
    flow: [
      { key: 'recebimento', label: 'Recebimento', value: received },
      { key: 'estoque', label: 'Estoque', value: sum(active.map((item) => item.stockQty)) },
      { key: 'montagem', label: 'Montagem', value: produced },
      { key: 'etiquetas', label: 'Etiquetas', value: labels },
      { key: 'expedicao', label: 'Expedição', value: shipped },
    ],
    productionSeries: productionSeries(days),
    inOut: inOutSeries(days),
    critical: critical.slice(0, 6).map((item) => ({ name: item.name, stock: item.stockQty, min: item.minStock, unit: item.unit })),
    ranking,
    movements: q(`SELECT m.date, m.time, m.type, m.item_name, m.quantity, m.origin, u.name AS user_name FROM movements m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.id DESC LIMIT 8`),
    alerts: getAlerts().slice(0, 6),
  };
}

function inOutSeries(days) {
  const rows = q(
    `SELECT date,
        COALESCE(SUM(CASE WHEN type = 'entrada' AND quantity > 0 THEN quantity ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN type = 'expedicao' AND quantity < 0 THEN -quantity ELSE 0 END), 0) AS saidas
     FROM movements
     WHERE date >= ? AND reversed_at IS NULL AND reversal_of IS NULL
     GROUP BY date`,
    [days[0]],
  );
  const map = new Map(rows.map((row) => [row.date, row]));
  return days.map((date) => ({ date, entradas: map.get(date)?.entradas || 0, saidas: map.get(date)?.saidas || 0 }));
}

export function stockDashboard() {
  const from = addDays(today(), -29);
  const categories = q(
    `SELECT COALESCE(c.name, 'Sem categoria') AS name, COALESCE(SUM(p.stock_qty), 0) AS qty
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.status = 'ativo' GROUP BY c.id ORDER BY qty DESC`,
  );
  const byProduct = q(
    `SELECT name, stock_qty AS qty, unit, type FROM products WHERE status = 'ativo' ORDER BY stock_qty DESC LIMIT 8`,
  );
  const giro = q(
    `SELECT p.id, p.name, p.sale_price, p.stock_qty,
        COALESCE(SUM(CASE WHEN m.quantity < 0 THEN -m.quantity ELSE 0 END), 0) AS qty
     FROM products p
     LEFT JOIN movements m ON m.item_type = 'product' AND m.item_id = p.id AND m.type = 'expedicao'
       AND m.reversed_at IS NULL AND m.date >= ?
     GROUP BY p.id`,
    [from],
  ).map((row) => ({ ...row, value: round(row.qty * (row.salePrice || 0)) }));
  const ranked = [...giro].sort((a, b) => b.value - a.value || b.qty - a.qty);
  const totalValue = sum(ranked.map((row) => row.value)) || 1;
  let running = 0;
  const abc = ranked.map((row) => {
    running += row.value;
    const share = running / totalValue;
    return { ...row, share, klass: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C' };
  });
  const idle = giro.filter((row) => row.stockQty > 0 && row.qty <= 0).slice(0, 8);
  const days = daysBetween(addDays(today(), -13), today());
  return {
    inOut: inOutSeries(daysBetween(from, today())),
    categories,
    byProduct,
    giroTop: [...giro].sort((a, b) => b.qty - a.qty).slice(0, 6),
    giroLow: [...giro].filter((row) => row.stockQty > 0).sort((a, b) => a.qty - b.qty).slice(0, 6),
    critical: getAlerts().filter((alert) => ['estoque_minimo', 'estoque_proximo', 'falta_componente', 'falta_embalagem'].includes(alert.code)),
    idle,
    abc: abc.slice(0, 12),
    packagingUse: packagingSeries(days),
  };
}

function packagingSeries(days) {
  const materials = q(`SELECT id, name FROM materials WHERE active = 1 ORDER BY name`);
  return materials.map((material) => {
    const rows = q(
      `SELECT date, COALESCE(SUM(CASE WHEN quantity < 0 THEN -quantity ELSE 0 END), 0) AS qty
       FROM movements
       WHERE item_type = 'material' AND item_id = ? AND date >= ? AND reversed_at IS NULL AND type IN ('montagem', 'expedicao')
       GROUP BY date`,
      [material.id, days[0]],
    );
    const map = new Map(rows.map((row) => [row.date, row.qty]));
    return { name: material.name, points: days.map((date) => ({ date, qty: map.get(date) || 0 })) };
  });
}

function snapshot(from, to) {
  const qty = one(`SELECT COALESCE(SUM(quantity), 0) AS qty FROM productions WHERE status = 'confirmada' AND date >= ? AND date <= ?`, [from, to])?.qty || 0;
  const days = daysBetween(from, to).length;
  const goal = sum(q('SELECT target_qty FROM goals WHERE active = 1').map((row) => row.targetQty)) * days;
  return { from, to, qty, goal, efficiency: goal > 0 ? qty / goal : null };
}

export function productionDashboard() {
  const day = today();
  const span = productivity(monthStart(day), day);
  return {
    today: snapshot(day, day),
    yesterday: snapshot(addDays(day, -1), addDays(day, -1)),
    week: snapshot(addDays(day, -6), day),
    month: snapshot(monthStart(day), day),
    byDay: span.byDay,
    byProduct: span.byProduct,
    byUser: span.ranking,
    byShift: span.byShift,
  };
}

export function productivity(from, to) {
  const rows = q(
    `SELECT p.*, u.name AS user_name, s.name AS shift_name, s.start_time, s.end_time, s.target_qty AS shift_target, pr.name AS product_name
     FROM productions p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN shifts s ON s.id = p.shift_id
     JOIN products pr ON pr.id = p.product_id
     WHERE p.status = 'confirmada' AND p.date >= ? AND p.date <= ?`,
    [from, to],
  );
  const goals = new Map(q('SELECT user_id, target_qty FROM goals WHERE active = 1').map((row) => [row.userId, row.targetQty]));
  const dayCount = Math.max(1, daysBetween(from, to).length);
  const users = new Map();
  for (const row of rows) {
    const bucket = users.get(row.userId) || { userId: row.userId, name: row.userName, qty: 0, days: new Set(), hours: 0, seen: new Set() };
    bucket.qty = round(bucket.qty + row.quantity);
    bucket.days.add(row.date);
    const mark = `${row.date}:${row.shiftId || 0}`;
    if (!bucket.seen.has(mark) && row.startTime && row.endTime) {
      bucket.hours += shiftHours(row.startTime, row.endTime);
      bucket.seen.add(mark);
    }
    users.set(row.userId, bucket);
  }
  const ranking = [...users.values()].map((user) => {
    const goal = (goals.get(user.userId) || 0) * dayCount;
    return {
      userId: user.userId,
      name: user.name,
      qty: user.qty,
      goal,
      efficiency: goal > 0 ? user.qty / goal : null,
      perHour: user.hours > 0 ? round(user.qty / user.hours) : null,
      days: user.days.size,
    };
  }).sort((a, b) => b.qty - a.qty);
  for (const [userId, target] of goals) {
    if (!users.has(userId)) {
      const person = one('SELECT name FROM users WHERE id = ?', [userId]);
      ranking.push({ userId, name: person?.name || 'Colaborador', qty: 0, goal: target * dayCount, efficiency: 0, perHour: 0, days: 0 });
    }
  }
  const byProductMap = new Map();
  const byShiftMap = new Map();
  const byDayMap = new Map();
  for (const row of rows) {
    byProductMap.set(row.productName, round((byProductMap.get(row.productName) || 0) + row.quantity));
    const shiftName = row.shiftName || 'Sem turno';
    const shift = byShiftMap.get(shiftName) || { name: shiftName, qty: 0, target: (row.shiftTarget || 0) * dayCount };
    shift.qty = round(shift.qty + row.quantity);
    byShiftMap.set(shiftName, shift);
    byDayMap.set(row.date, round((byDayMap.get(row.date) || 0) + row.quantity));
  }
  return {
    from,
    to,
    total: sum(ranking.map((row) => row.qty)),
    ranking: ranking.sort((a, b) => b.qty - a.qty),
    byProduct: [...byProductMap.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
    byShift: [...byShiftMap.values()].map((shift) => ({ ...shift, efficiency: shift.target > 0 ? shift.qty / shift.target : null })),
    byDay: daysBetween(from, to).map((date) => ({ date, qty: byDayMap.get(date) || 0 })),
    average: ranking.length ? round(sum(ranking.map((row) => row.qty)) / ranking.length) : 0,
  };
}

export function packagingDashboard() {
  const materials = q(`SELECT m.*, s.name AS supplier_name FROM materials m LEFT JOIN suppliers s ON s.id = m.supplier_id WHERE m.active = 1 ORDER BY m.name`);
  return materials.map((material) => {
    const cover = coverOf(material, 'material');
    return {
      ...material,
      packages: material.packageContent ? round(material.stockQty / material.packageContent) : null,
      ...cover,
    };
  });
}

const SUGGESTIONS = [
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

function reply(data) {
  return {
    intent: data.intent,
    title: data.title,
    answer: data.answer,
    tone: data.tone || 'info',
    metrics: data.metrics || [],
    table: data.table || null,
    suggestions: data.suggestions || SUGGESTIONS.slice(0, 4),
  };
}

function named(items, question) {
  const qn = fold(question);
  const found = items.map((item) => {
    const name = fold(item.name);
    if (name && qn.includes(name)) return { item, score: name.length + 50 };
    const sku = fold(item.sku || item.code || '');
    if (sku && sku.length > 2 && qn.includes(sku)) return { item, score: sku.length + 40 };
    const tokens = name.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    const hits = tokens.filter((token) => qn.includes(token)).length;
    if (!hits) return null;
    if (tokens.length > 1 && hits === 1 && tokens[0].length < 6) return null;
    return { item, score: hits };
  }).filter(Boolean).sort((a, b) => (
    b.score - a.score
    || Number(b.item.type === 'unitario') - Number(a.item.type === 'unitario')
    || a.item.name.length - b.item.name.length
  ));
  if (!found.length) return [];
  const best = found[0].score;
  const top = found.filter((item) => item.score === best);
  if (top.length > 1 && top.some((item) => item.item.type === 'unitario')) {
    return [top.find((item) => item.item.type === 'unitario').item];
  }
  return top.map((item) => item.item);
}

function periodOf(question) {
  const qn = fold(question);
  const day = today();
  if (qn.includes('ontem')) return { from: addDays(day, -1), to: addDays(day, -1), label: 'ontem' };
  if (qn.includes('semana')) return { from: addDays(day, -6), to: day, label: 'nos últimos 7 dias' };
  if (qn.includes('mes')) return { from: monthStart(day), to: day, label: 'neste mês' };
  if (qn.includes('ano')) return { from: `${day.slice(0, 4)}-01-01`, to: day, label: 'neste ano' };
  return { from: day, to: day, label: 'hoje' };
}

function principalKit(products) {
  return products.filter((item) => item.type === 'kit' || (item.type === 'combo' && item.comboMode === 'fisico'))
    .sort((a, b) => b.stockQty - a.stockQty)[0];
}

function tableOf(columns, rows) {
  return { columns, rows };
}

export function ask(question, user) {
  const qn = fold(question);
  const products = q(`SELECT * FROM products WHERE status = 'ativo'`);
  const materials = q(`SELECT * FROM materials WHERE active = 1`);
  const mentionedProducts = named(products, question);
  const mentionedMaterials = named(materials, question);
  const mine = /\b(minha|meu|eu)\b/.test(qn);
  const period = periodOf(question);
  const produceMatch = qn.match(/produzir\s+(\d[\d.]*)/);
  const wantsNeed = produceMatch && /precis|necess|vou precisar|quanto|quanta/.test(qn);
  if (wantsNeed) return needFor(Number(produceMatch[1].replace(/\./g, '')), mentionedProducts, mentionedMaterials, products);
  if (/quantos kits|quantas unidades consigo|capacidade|consigo produzir|posso produzir|consigo montar|da para produzir/.test(qn)) {
    return capacityAnswer(mentionedProducts, products);
  }
  if (qn.includes('gargalo')) return bottleneckAnswer(mentionedProducts, products, materials);
  if (/vai durar|quantos dias|cobertura|projetad|durar/.test(qn)) return coverAnswer(mentionedProducts, mentionedMaterials, products);
  if (/critico|abaixo do minimo|reposi/.test(qn)) return criticalAnswer();
  if (/quem produziu|quem fez mais|ranking|mais produziu/.test(qn)) return rankingAnswer(period);
  if (/mais vendid|maior giro|mais exped|mais saiu/.test(qn)) return sellerAnswer(period, mine);
  if (/entraram|entrou|recebi|recebimento|deram entrada/.test(qn)) return entriesAnswer(period, mentionedProducts, mentionedMaterials);
  if (qn.includes('turno')) return shiftAnswer(period);
  if (/producao|produzi|produziu|montei|montamos/.test(qn)) return productionAnswer(period, mine ? user : null);
  if (/quanto|quantos|quantas|tenho|estoque|saldo/.test(qn) && (mentionedProducts.length || mentionedMaterials.length)) {
    return stockAnswer(mentionedProducts, mentionedMaterials);
  }
  if (/shopee|shein|sheen/.test(qn) || ((/jet|j&t|j e t/.test(qn)) && /unific|etiqueta/.test(qn))) return carrierRuleAnswer();
  if (/duplic|reimpress|unific|mesma etiqueta|mesmo arquivo|imprimir de novo|perda de etiqueta/.test(qn)) return duplicateAnswer();
  if (/como esta|resumo|situacao|briefing|operacao|bom dia|visao geral|o que preciso|gargalos/.test(qn) || qn.length < 8) {
    return briefing(user);
  }
  if (mentionedProducts.length || mentionedMaterials.length) return stockAnswer(mentionedProducts, mentionedMaterials);
  return briefing(user, 'Não identifiquei um indicador específico, então resumí a operação.');
}

function capacityAnswer(mentioned, products) {
  const kits = (mentioned.length ? mentioned : [principalKit(products)].filter(Boolean))
    .filter((item) => item.type === 'kit' || item.type === 'combo');
  const target = kits.length ? kits : products.filter((item) => item.type === 'kit');
  const rows = target.map(capacityOf);
  const lead = rows[0];
  return reply({
    intent: 'capacity',
    title: 'Capacidade de produção',
    tone: lead && lead.max < (lead.limits.find((line) => line.kind === 'embalagem')?.stock || 1) ? 'warning' : 'info',
    answer: rows.map((row) => `${row.productName}: ${row.sentence}`).join('\n\n') || 'Não há kits ativos para calcular.',
    metrics: rows.slice(0, 3).map((row) => ({ label: row.productName, value: `${n(row.max)} kits`, hint: row.bottleneck ? `Gargalo: ${row.bottleneck.name}` : '' })),
    table: lead ? tableOf(
      [{ key: 'name', label: 'Item' }, { key: 'kind', label: 'Tipo' }, { key: 'stock', label: 'Disponível' }, { key: 'perUnit', label: 'Por kit' }, { key: 'can', label: 'Limite' }],
      lead.limits,
    ) : null,
  });
}

function bottleneckAnswer(mentioned, products, materials) {
  const kit = mentioned.find((item) => item.type !== 'unitario') || principalKit(products);
  if (!kit) return reply({ intent: 'bottleneck', title: 'Gargalo', answer: 'Não há kit cadastrado para analisar.' });
  const capacity = capacityOf(kit);
  const packaging = capacity.limits.filter((line) => line.kind === 'embalagem').sort((a, b) => a.can - b.can);
  const limit = packaging[0] || capacity.bottleneck;
  return reply({
    intent: 'bottleneck',
    title: 'Gargalo da operação',
    tone: 'warning',
    answer: limit
      ? `O gargalo de ${kit.name} é ${limit.name}. Ele limita a montagem a ${n(limit.can)} kits. ${capacity.sentence}`
      : capacity.sentence,
    metrics: [{ label: 'Item limitante', value: limit?.name || '—', hint: limit ? `${nFlex(limit.stock)} ${limit.unit} em estoque` : '' }],
    table: tableOf(
      [{ key: 'name', label: 'Item' }, { key: 'kind', label: 'Tipo' }, { key: 'can', label: 'Kits possíveis' }],
      capacity.limits,
    ),
    suggestions: materials.slice(0, 1).length ? SUGGESTIONS.slice(7, 10) : undefined,
  });
}

function needFor(quantity, mentionedProducts, mentionedMaterials, products) {
  const kit = mentionedProducts.find((item) => item.type !== 'unitario') || principalKit(products);
  if (!kit) return reply({ intent: 'need', title: 'Necessidade de material', answer: 'Não encontrei um kit para calcular essa produção.' });
  const capacity = capacityOf(kit);
  let lines = capacity.limits.map((line) => ({
    ...line,
    required: round(line.perUnit * quantity),
    enough: line.stock + 0.0001 >= line.perUnit * quantity,
  }));
  if (mentionedMaterials.length) {
    const names = new Set(mentionedMaterials.map((item) => item.name));
    const filtered = lines.filter((line) => names.has(line.name));
    if (filtered.length) lines = filtered;
  }
  const missing = lines.filter((line) => !line.enough);
  const focus = lines[0];
  return reply({
    intent: 'need',
    title: `Necessidade para ${n(quantity)} kits`,
    tone: missing.length ? 'danger' : 'ok',
    answer: missing.length
      ? `Para produzir ${n(quantity)} ${kit.name}, falta estoque de ${missing.map((line) => line.name).join(', ')}.`
      : `Para produzir ${n(quantity)} ${kit.name}, ${focus ? `${focus.name} necessário: ${nFlex(focus.required)} ${focus.unit}. Você tem ${nFlex(focus.stock)} ${focus.unit}.` : 'a composição está coberta.'}`,
    metrics: lines.slice(0, 3).map((line) => ({ label: line.name, value: `${nFlex(line.required)} ${line.unit}`, hint: `Em estoque: ${nFlex(line.stock)}` })),
    table: tableOf(
      [{ key: 'name', label: 'Item' }, { key: 'required', label: 'Necessário' }, { key: 'stock', label: 'Estoque' }, { key: 'unit', label: 'Un.' }],
      lines,
    ),
  });
}

function coverAnswer(mentionedProducts, mentionedMaterials, products) {
  const items = [
    ...mentionedMaterials.map((item) => ({ ...item, itemType: 'material' })),
    ...mentionedProducts.map((item) => ({ ...item, itemType: 'product' })),
  ];
  if (!items.length) {
    const main = principalKit(products);
    const cap = main ? capacityOf(main) : null;
    const materialName = cap?.bottleneck?.name;
    const material = materialName ? q('SELECT * FROM materials WHERE name = ?', [materialName])[0] : null;
    if (material) items.push({ ...material, itemType: 'material' });
  }
  if (!items.length) return reply({ intent: 'cover', title: 'Cobertura de estoque', answer: 'Diga o produto ou a embalagem que devo projetar.' });
  const rows = items.map((item) => ({ item, cover: coverOf(item, item.itemType) }));
  const lead = rows[0];
  const daysText = lead.cover.days == null ? 'sem consumo recente para projetar' : `${n(lead.cover.days, 1)} dias`;
  const alert = lead.cover.status !== 'ok' || (lead.cover.days != null && lead.cover.days < 7);
  return reply({
    intent: 'cover',
    title: 'Estoque projetado',
    tone: alert ? 'warning' : 'ok',
    answer: `${lead.item.name}: consumo médio de ${nFlex(lead.cover.daily)} ${lead.item.unit}/dia e estoque de ${nFlex(lead.item.stockQty)} ${lead.item.unit}. Estoque projetado: ${daysText}.${alert ? ' ALERTA DE REPOSIÇÃO.' : ''}`,
    metrics: rows.map(({ item, cover }) => ({ label: item.name, value: cover.days == null ? '—' : `${n(cover.days, 1)} dias`, hint: `${nFlex(cover.daily)} ${item.unit}/dia` })),
  });
}

function criticalAnswer() {
  const alerts = getAlerts().filter((alert) => ['estoque_minimo', 'estoque_proximo', 'falta_componente', 'falta_embalagem'].includes(alert.code));
  return reply({
    intent: 'critical',
    title: 'Estoques críticos',
    tone: alerts.some((alert) => alert.level === 'danger') ? 'danger' : 'warning',
    answer: alerts.length ? alerts.map((alert) => alert.message).join(' ') : 'Nenhum item está abaixo ou próximo do mínimo.',
    metrics: alerts.slice(0, 3).map((alert) => ({ label: alert.title, value: 'Atenção', hint: alert.message })),
  });
}

function productionAnswer(period, user) {
  const params = [period.from, period.to];
  let sql = `SELECT COALESCE(SUM(quantity), 0) AS qty FROM productions WHERE status = 'confirmada' AND date >= ? AND date <= ?`;
  if (user) {
    sql += ' AND user_id = ?';
    params.push(user.id);
  }
  const qty = one(sql, params)?.qty || 0;
  const operation = one(`SELECT COALESCE(SUM(quantity), 0) AS qty FROM productions WHERE status = 'confirmada' AND date >= ? AND date <= ?`, [period.from, period.to])?.qty || 0;
  const answer = user
    ? (qty > 0 ? `${user.name.split(' ')[0]}, sua produção ${period.label} foi de ${nFlex(qty)} kits.` : `${user.name.split(' ')[0]}, você não registrou produção ${period.label}. A operação fez ${nFlex(operation)} kits.`)
    : `A produção ${period.label} foi de ${nFlex(qty)} kits.`;
  return reply({
    intent: 'production',
    title: 'Produção',
    tone: 'info',
    answer,
    metrics: [{ label: period.label, value: `${nFlex(user ? qty : operation)} kits` }],
  });
}

function rankingAnswer(period) {
  const rows = q(
    `SELECT u.name, COALESCE(SUM(p.quantity), 0) AS qty
     FROM productions p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'confirmada' AND p.date >= ? AND p.date <= ?
     GROUP BY u.id ORDER BY qty DESC`,
    [period.from, period.to],
  );
  const lead = rows[0];
  return reply({
    intent: 'ranking',
    title: 'Ranking de produtividade',
    answer: lead ? `${lead.name} produziu mais ${period.label}: ${nFlex(lead.qty)} kits.` : `Não há produção registrada ${period.label}.`,
    metrics: rows.slice(0, 3).map((row, index) => ({ label: `${index + 1}º ${row.name}`, value: `${nFlex(row.qty)} kits` })),
    table: tableOf([{ key: 'name', label: 'Colaborador' }, { key: 'qty', label: 'Produção' }], rows),
  });
}

function sellerAnswer(period) {
  const rows = q(
    `SELECT p.name, COALESCE(SUM(e.quantity), 0) AS qty
     FROM expeditions e JOIN products p ON p.id = e.product_id
     WHERE e.status = 'confirmada' AND e.date >= ? AND e.date <= ?
     GROUP BY p.id ORDER BY qty DESC LIMIT 8`,
    [period.from, period.to],
  );
  const lead = rows[0];
  return reply({
    intent: 'seller',
    title: 'Produto mais expedido',
    answer: lead ? `O produto mais expedido ${period.label} foi ${lead.name}, com ${nFlex(lead.qty)} unidades.` : `Não há expedição ${period.label}.`,
    metrics: rows.slice(0, 3).map((row) => ({ label: row.name, value: nFlex(row.qty) })),
  });
}

function entriesAnswer(period, mentionedProducts, mentionedMaterials) {
  const items = [
    ...mentionedProducts.map((item) => ({ ...item, itemType: 'product' })),
    ...mentionedMaterials.map((item) => ({ ...item, itemType: 'material' })),
  ];
  if (!items.length) {
    const total = one(
      `SELECT COALESCE(SUM(ei.quantity), 0) AS qty FROM entry_items ei JOIN entries e ON e.id = ei.entry_id
       WHERE e.status = 'confirmada' AND e.date >= ? AND e.date <= ? AND ei.item_type = 'product'`,
      [period.from, period.to],
    )?.qty || 0;
    return reply({ intent: 'entries', title: 'Entradas', answer: `Entraram ${nFlex(total)} unidades de produtos ${period.label}.`, metrics: [{ label: period.label, value: nFlex(total) }] });
  }
  const parts = items.map((item) => {
    const qty = one(
      `SELECT COALESCE(SUM(ei.quantity), 0) AS qty FROM entry_items ei JOIN entries e ON e.id = ei.entry_id
       WHERE e.status = 'confirmada' AND e.date >= ? AND e.date <= ? AND ei.item_type = ? AND ei.item_id = ?`,
      [period.from, period.to, item.itemType, item.id],
    )?.qty || 0;
    return { name: item.name, qty, unit: item.unit };
  });
  return reply({
    intent: 'entries',
    title: 'Entradas',
    answer: parts.map((item) => `${nFlex(item.qty)} ${item.unit} de ${item.name} entraram ${period.label}.`).join(' '),
    metrics: parts.map((item) => ({ label: item.name, value: `${nFlex(item.qty)} ${item.unit}` })),
  });
}

function shiftAnswer(period) {
  const report = productivity(period.from, period.to);
  const lead = [...report.byShift].sort((a, b) => b.qty - a.qty)[0];
  return reply({
    intent: 'shift',
    title: 'Produção por turno',
    answer: lead ? `${lead.name} produziu mais ${period.label}: ${nFlex(lead.qty)} kits.` : `Sem produção por turno ${period.label}.`,
    metrics: report.byShift.map((shift) => ({ label: shift.name, value: `${nFlex(shift.qty)} kits`, hint: shift.efficiency != null ? `${n(shift.efficiency * 100, 0)}% da meta` : '' })),
  });
}

function stockAnswer(mentionedProducts, mentionedMaterials) {
  const rows = [
    ...mentionedProducts.map((item) => ({ name: item.name, stock: item.stockQty, unit: item.unit, min: item.minStock })),
    ...mentionedMaterials.map((item) => ({ name: item.name, stock: item.stockQty, unit: item.unit, min: item.minStock, packages: item.packageContent ? item.stockQty / item.packageContent : null, packageUnit: item.packageUnit })),
  ];
  return reply({
    intent: 'stock',
    title: 'Posição de estoque',
    tone: rows.some((row) => row.min > 0 && row.stock <= row.min) ? 'danger' : 'info',
    answer: rows.map((row) => {
      const pack = row.packages != null ? ` (${nFlex(row.packages)} ${row.packageUnit || 'volumes'})` : '';
      return `${row.name}: ${nFlex(row.stock)} ${row.unit}${pack}.`;
    }).join(' '),
    metrics: rows.map((row) => ({ label: row.name, value: `${nFlex(row.stock)} ${row.unit}`, hint: row.min ? `Mínimo ${nFlex(row.min)}` : '' })),
  });
}

function countLabel(total, one, many) {
  return `${total} ${total === 1 ? one : many}`;
}

function labelSecurityLine() {
  const security = labelSecurity();
  if (!security.blocked.length && !security.pairs.length) return null;
  const parts = [];
  if (security.blocked.length) parts.push(`a trava segurou ${countLabel(security.blocked.length, 'tentativa de reimprimir', 'tentativas de reimprimir')}`);
  if (security.pairs.length) parts.push(`há ${countLabel(security.pairs.length, 'possível duplicidade', 'possíveis duplicidades')}`);
  return `Etiquetas: ${parts.join(' e ')}.`;
}

function carrierRuleAnswer() {
  return reply({
    intent: 'label-carrier',
    title: 'Quem pode unificar',
    tone: 'warning',
    answer: 'Só etiquetas da J&T podem ser unificadas. Etiquetas da Shopee e da Shein não entram nesse fluxo.',
    metrics: [
      { label: 'J&T', value: 'Pode unificar' },
      { label: 'Shopee', value: 'Bloqueada' },
      { label: 'Shein', value: 'Bloqueada' },
    ],
  });
}

function duplicateAnswer() {
  const security = labelSecurity();
  if (!security.blocked.length && !security.reprints.length && !security.pairs.length) {
    return reply({
      intent: 'label-security',
      title: 'Segurança das etiquetas',
      tone: 'ok',
      answer: security.printed
        ? `${security.printed} arquivo(s) já foram unificados e impressos uma vez. Nenhuma duplicidade em aberto.`
        : 'Nenhuma etiqueta unificada foi impressa ainda. A trava segura o mesmo arquivo na segunda tentativa.',
    });
  }
  const lines = [];
  if (security.blocked.length) lines.push(`A trava segurou ${countLabel(security.blocked.length, 'tentativa', 'tentativas')} de imprimir de novo. A última foi ${security.blocked[0].sourceFile}, em ${security.blocked[0].when}.`);
  if (security.pairs.length) {
    lines.push(`Possível duplicidade: ${security.pairs.map((pair) => (
      pair.kind === 'pedido'
        ? `${pair.left} e ${pair.right} compartilham o pedido ${pair.shared}`
        : `${pair.left} e ${pair.right} têm o mesmo nome e tamanho`
    )).join('; ')}.`);
  }
  if (security.reprints.length) lines.push(`${countLabel(security.reprints.length, 'reimpressão foi autorizada', 'reimpressões foram autorizadas')} por um administrador.`);
  return reply({
    intent: 'label-security',
    title: 'Segurança das etiquetas',
    tone: 'warning',
    answer: lines.join(' '),
    metrics: [
      { label: 'Travadas', value: String(security.blocked.length) },
      { label: 'Parecidas', value: String(security.pairs.length) },
      { label: 'Reimpressões', value: String(security.reprints.length) },
    ],
  });
}

function briefing(user, preface) {
  const view = overview(user);
  const caps = capacities();
  const main = caps[0];
  const behind = view.alerts.find((alert) => alert.code === 'abaixo_meta');
  const parts = [
    preface,
    `Hoje a operação produziu ${nFlex(view.kpis.productionToday)} kits e expediu ${nFlex(view.kpis.expeditionsToday)}.`,
    main ? main.sentence : null,
    view.kpis.criticalCount ? `${view.kpis.criticalCount} item(ns) estão no mínimo ou abaixo.` : 'Nenhum estoque está abaixo do mínimo.',
    behind ? behind.message : null,
    labelSecurityLine(),
  ].filter(Boolean);
  return reply({
    intent: 'briefing',
    title: 'Leitura da operação',
    tone: view.kpis.criticalCount ? 'warning' : 'ok',
    answer: parts.join(' '),
    metrics: [
      { label: 'Produção hoje', value: `${nFlex(view.kpis.productionToday)} kits` },
      { label: 'Capacidade', value: main ? `${n(main.max)} kits` : '—' },
      { label: 'Críticos', value: String(view.kpis.criticalCount) },
    ],
  });
}
