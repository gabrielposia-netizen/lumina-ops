import { q } from './db.js';
import { packagingDashboard, productivity } from './insights.js';
import { monthStart, today } from './lib.js';
import { listEntries, listExpeditions, listInventories, listMovements } from './stock.js';
import { listLabels } from './labels.js';

function columns(pairs) {
  return pairs.map(([key, label]) => ({ key, label }));
}

export function buildReport(type, filters = {}) {
  const from = filters.from || monthStart();
  const to = filters.to || today();
  const within = (date) => (!date || (date >= from && date <= to));
  switch (type) {
    case 'estoque':
      return {
        title: 'Relatório de estoque',
        columns: columns([['code', 'Código'], ['sku', 'SKU'], ['name', 'Produto'], ['type', 'Tipo'], ['category', 'Categoria'], ['stock', 'Estoque'], ['min', 'Mínimo'], ['max', 'Máximo'], ['location', 'Localização'], ['cost', 'Custo'], ['value', 'Valor']]),
        rows: q(`SELECT p.internal_code AS code, p.sku, p.name, p.type, c.name AS category, p.stock_qty AS stock, p.min_stock AS min, p.max_stock AS max, p.location, p.cost_price AS cost, ROUND(p.stock_qty * p.cost_price, 2) AS value FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.name`),
      };
    case 'entradas':
      return {
        title: 'Relatório de entradas',
        columns: columns([['date', 'Data'], ['invoice', 'Nota'], ['supplier', 'Fornecedor'], ['item', 'Item'], ['qty', 'Quantidade'], ['lot', 'Lote'], ['expiry', 'Validade'], ['user', 'Responsável']]),
        rows: listEntries().filter((entry) => within(entry.date)).flatMap((entry) => entry.items.map((item) => ({
          date: entry.date, invoice: entry.invoice, supplier: entry.supplierName, item: item.itemName, qty: item.quantity, lot: item.lotCode, expiry: item.expiryDate, user: entry.userName,
        }))),
      };
    case 'saidas':
    case 'expedicao':
      return {
        title: type === 'saidas' ? 'Relatório de saídas' : 'Relatório de expedição',
        columns: columns([['date', 'Data'], ['sku', 'SKU'], ['product', 'Produto'], ['qty', 'Quantidade'], ['lot', 'Lote'], ['channel', 'Canal'], ['order', 'Pedido'], ['user', 'Usuário'], ['status', 'Status']]),
        rows: listExpeditions().filter((row) => within(row.date)).map((row) => ({
          date: row.date, sku: row.sku, product: row.productName, qty: row.quantity, lot: row.lotCode, channel: row.channel, order: row.orderRef, user: row.userName, status: row.status,
        })),
      };
    case 'producao':
      return {
        title: 'Relatório de produção',
        columns: columns([['date', 'Data'], ['time', 'Hora'], ['order', 'Ordem'], ['product', 'Produto'], ['qty', 'Quantidade'], ['user', 'Colaborador'], ['shift', 'Turno'], ['status', 'Status']]),
        rows: q(`SELECT p.date, p.time, p.order_code AS "order", pr.name AS product, p.quantity AS qty, u.name AS user, s.name AS shift, p.status FROM productions p JOIN products pr ON pr.id = p.product_id JOIN users u ON u.id = p.user_id LEFT JOIN shifts s ON s.id = p.shift_id WHERE p.date >= ? AND p.date <= ? ORDER BY p.date, p.time`, [from, to]),
      };
    case 'produtividade': {
      const report = productivity(from, to);
      return {
        title: 'Relatório de produtividade',
        columns: columns([['name', 'Colaborador'], ['qty', 'Produzido'], ['goal', 'Meta'], ['efficiency', 'Eficiência'], ['perHour', 'Por hora'], ['days', 'Dias']]),
        rows: report.ranking.map((row) => ({ ...row, efficiency: row.efficiency == null ? '' : `${Math.round(row.efficiency * 100)}%` })),
      };
    }
    case 'kits':
      return {
        title: 'Relatório de kits',
        columns: columns([['kit', 'Kit'], ['sku', 'SKU'], ['component', 'Componente'], ['perKit', 'Qtd por kit'], ['stock', 'Estoque do componente']]),
        rows: q(`SELECT parent.name AS kit, parent.sku, child.name AS component, c.quantity AS per_kit, child.stock_qty AS stock FROM compositions c JOIN products parent ON parent.id = c.parent_id JOIN products child ON child.id = c.component_id ORDER BY parent.name, child.name`).map((row) => ({ kit: row.kit, sku: row.sku, component: row.component, perKit: row.perKit, stock: row.stock })),
      };
    case 'componentes':
      return {
        title: 'Relatório de componentes',
        columns: columns([['name', 'Componente'], ['sku', 'SKU'], ['stock', 'Estoque'], ['consumed', 'Consumido no período']]),
        rows: q(
          `SELECT p.name, p.sku, p.stock_qty AS stock, COALESCE(SUM(CASE WHEN m.quantity < 0 THEN -m.quantity ELSE 0 END), 0) AS consumed
           FROM products p JOIN compositions c ON c.component_id = p.id
           LEFT JOIN movements m ON m.item_type = 'product' AND m.item_id = p.id AND m.type = 'montagem' AND m.reversed_at IS NULL AND m.date >= ? AND m.date <= ?
           GROUP BY p.id ORDER BY p.name`,
          [from, to],
        ),
      };
    case 'embalagens':
      return {
        title: 'Relatório de embalagens',
        columns: columns([['code', 'Código'], ['name', 'Material'], ['stock', 'Estoque'], ['unit', 'Unidade'], ['min', 'Mínimo'], ['daily', 'Média diária'], ['days', 'Cobertura (dias)'], ['status', 'Status']]),
        rows: packagingDashboard().map((row) => ({ code: row.code, name: row.name, stock: row.stockQty, unit: row.unit, min: row.minStock, daily: row.daily, days: row.days ?? '', status: row.status })),
      };
    case 'etiquetas':
      return {
        title: 'Relatório de etiquetas',
        columns: columns([['processed', 'Processada em'], ['file', 'Arquivo'], ['code', 'Código'], ['product', 'Produto'], ['qty', 'Quantidade'], ['lot', 'Lote'], ['status', 'Status'], ['user', 'Usuário']]),
        rows: listLabels().map((row) => ({ processed: row.processedAt, file: row.sourceFile, code: row.code, product: row.productName, qty: row.quantity, lot: row.lotCode, status: row.status, user: row.userName })),
      };
    case 'inventario':
    case 'divergencias': {
      const onlyDiff = type === 'divergencias';
      const rows = listInventories().flatMap((inventory) => {
        const counts = q('SELECT * FROM inventory_counts WHERE inventory_id = ?', [inventory.id]);
        return counts.filter((count) => within(inventory.date) && (!onlyDiff || Math.abs(count.difference) > 0.0001)).map((count) => ({
          date: inventory.date, item: count.itemName, system: count.systemQty, physical: count.physicalQty, difference: count.difference, justification: count.justification, user: inventory.userName,
        }));
      });
      return {
        title: onlyDiff ? 'Relatório de divergências' : 'Relatório de inventário',
        columns: columns([['date', 'Data'], ['item', 'Item'], ['system', 'Sistema'], ['physical', 'Físico'], ['difference', 'Diferença'], ['justification', 'Justificativa'], ['user', 'Usuário']]),
        rows,
      };
    }
    case 'consumo':
      return {
        title: 'Relatório de consumo',
        columns: columns([['date', 'Data'], ['item', 'Item'], ['type', 'Tipo'], ['qty', 'Quantidade'], ['origin', 'Origem'], ['reference', 'Referência'], ['user', 'Usuário']]),
        rows: listMovements({ from, to, limit: 2000 }).filter((row) => row.quantity < 0 && !row.reversedAt).map((row) => ({
          date: row.date, item: row.itemName, type: row.type, qty: Math.abs(row.quantity), origin: row.origin, reference: row.reference, user: row.userName,
        })),
      };
    default:
      return null;
  }
}

function cell(value) {
  const text = value == null ? '' : String(value);
  if (/[;"\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function xml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toCsv(report) {
  const header = report.columns.map((column) => cell(column.label)).join(';');
  const lines = report.rows.map((row) => report.columns.map((column) => cell(row[column.key])).join(';'));
  return `\uFEFF${[header, ...lines].join('\n')}`;
}

export function toXls(report) {
  const header = `<Row>${report.columns.map((column) => `<Cell><Data ss:Type="String">${xml(column.label)}</Data></Cell>`).join('')}</Row>`;
  const body = report.rows.map((row) => `<Row>${report.columns.map((column) => {
    const value = row[column.key];
    const numeric = typeof value === 'number';
    return `<Cell><Data ss:Type="${numeric ? 'Number' : 'String'}">${xml(value)}</Data></Cell>`;
  }).join('')}</Row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Relatorio"><Table>${header}${body}</Table></Worksheet>
</Workbook>`;
}
