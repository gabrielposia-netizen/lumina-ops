import { allows, bearer, login, logout, userFromRequest } from './auth.js';
import {
  getProduct, listCategories, listGoals, listMaterials, listProducts, listShifts, listSuppliers, listUsers,
  removeCategory, removeGoal, saveCategory, saveGoal, saveMaterial, saveProduct, saveShift, saveSupplier, saveUser,
  findProductByCode,
} from './catalog.js';
import { meta, logAlert } from './db.js';
import { ask, capacities, capacityOf, getAlerts, overview, packagingDashboard, productionDashboard, productivity, resolveAlert, stockDashboard } from './insights.js';
import { confirmLabels, listLabels, previewLabels } from './labels.js';
import { commitUnify, inspectUnify, listPrints } from './unify.js';
import { HttpError, monthStart, today } from './lib.js';
import { buildReport, toCsv, toXls } from './reports.js';
import { q } from './db.js';
import {
  countSheet, expedite, getEntry, getExpedition, getInventory, getProduction, listEntries, listExpeditions,
  listInventories, listLots, listMovements, listProductions, produce, receive, registerInventory, reverseDocument, transfer,
} from './stock.js';
import { resetDemo } from './seed.js';

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  if (req.body != null && req.body !== '') {
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body));
    if (typeof req.body === 'object') return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  }
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) reject(new HttpError(413, 'Arquivo muito grande.'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function matchPath(pattern, pathname) {
  const expected = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(':')) params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
    else if (expected[index] !== actual[index]) return null;
  }
  return params;
}

const routes = [
  { method: 'POST', path: '/api/auth/login', auth: false, handler: ({ body }) => login(body.email, body.password) },
  { method: 'POST', path: '/api/auth/logout', handler: ({ req }) => { logout(bearer(req)); return { ok: true }; } },
  { method: 'GET', path: '/api/auth/me', handler: ({ user }) => ({ user, today: today(), company: meta('company_name'), operation: meta('operation_name') }) },

  { method: 'GET', path: '/api/dashboard/overview', perm: 'dashboard', handler: ({ user }) => overview(user) },
  { method: 'GET', path: '/api/dashboard/stock', perm: 'stock', handler: () => stockDashboard() },
  { method: 'GET', path: '/api/dashboard/production', perm: ['production', 'productivity', 'dashboard'], handler: () => productionDashboard() },
  { method: 'GET', path: '/api/dashboard/packaging', perm: 'materials', handler: () => packagingDashboard() },
  { method: 'GET', path: '/api/alerts', perm: 'dashboard', handler: () => getAlerts() },
  { method: 'POST', path: '/api/alerts/:id/resolve', perm: 'dashboard', handler: ({ params, user }) => resolveAlert(params.id, user.id) },

  { method: 'GET', path: '/api/categories', perm: ['categories', 'products', 'entries'], handler: () => listCategories() },
  { method: 'POST', path: '/api/categories', perm: 'categories', mutate: true, handler: ({ body, user }) => saveCategory(body, user.id) },
  { method: 'PUT', path: '/api/categories/:id', perm: 'categories', mutate: true, handler: ({ params, body, user }) => saveCategory({ ...body, id: params.id }, user.id) },
  { method: 'DELETE', path: '/api/categories/:id', perm: 'categories', mutate: true, handler: ({ params, user }) => removeCategory(params.id, user.id) },

  { method: 'GET', path: '/api/suppliers', perm: ['suppliers', 'entries', 'materials'], handler: () => listSuppliers() },
  { method: 'POST', path: '/api/suppliers', perm: 'suppliers', mutate: true, handler: ({ body, user }) => saveSupplier(body, user.id) },
  { method: 'PUT', path: '/api/suppliers/:id', perm: 'suppliers', mutate: true, handler: ({ params, body, user }) => saveSupplier({ ...body, id: params.id }, user.id) },

  { method: 'GET', path: '/api/products/lookup', perm: 'products', handler: ({ query }) => findProductByCode(query.code, query.name) || null },
  { method: 'GET', path: '/api/products/:id/capacity', perm: ['products', 'kits', 'production'], handler: ({ params }) => capacityOf(getProduct(params.id)) },
  { method: 'GET', path: '/api/products/:id', perm: 'products', handler: ({ params }) => getProduct(params.id) },
  { method: 'GET', path: '/api/products', perm: 'products', handler: ({ query }) => listProducts(query) },
  { method: 'POST', path: '/api/products', perm: 'products', mutate: true, handler: ({ body, user }) => saveProduct(body, user.id) },
  { method: 'PUT', path: '/api/products/:id', perm: 'products', mutate: true, handler: ({ params, body, user }) => saveProduct({ ...body, id: params.id }, user.id) },
  { method: 'GET', path: '/api/kits/capacity', perm: ['kits', 'production'], handler: () => capacities() },

  { method: 'GET', path: '/api/materials', perm: 'materials', handler: () => listMaterials() },
  { method: 'POST', path: '/api/materials', perm: 'materials', mutate: true, handler: ({ body, user }) => saveMaterial(body, user.id) },
  { method: 'PUT', path: '/api/materials/:id', perm: 'materials', mutate: true, handler: ({ params, body, user }) => saveMaterial({ ...body, id: params.id }, user.id) },

  { method: 'GET', path: '/api/users', perm: 'users', handler: () => listUsers() },
  { method: 'POST', path: '/api/users', perm: 'users', mutate: true, handler: ({ body, user }) => saveUser(body, user.id) },
  { method: 'PUT', path: '/api/users/:id', perm: 'users', mutate: true, handler: ({ params, body, user }) => saveUser({ ...body, id: params.id }, user.id) },

  { method: 'GET', path: '/api/shifts', perm: ['shifts', 'production', 'productivity'], handler: () => listShifts() },
  { method: 'POST', path: '/api/shifts', perm: 'shifts', mutate: true, handler: ({ body, user }) => saveShift(body, user.id) },
  { method: 'PUT', path: '/api/shifts/:id', perm: 'shifts', mutate: true, handler: ({ params, body, user }) => saveShift({ ...body, id: params.id }, user.id) },

  { method: 'GET', path: '/api/goals', perm: ['goals', 'productivity'], handler: () => listGoals() },
  { method: 'POST', path: '/api/goals', perm: 'goals', mutate: true, handler: ({ body, user }) => saveGoal(body, user.id) },
  { method: 'DELETE', path: '/api/goals/:id', perm: 'goals', mutate: true, handler: ({ params, user }) => removeGoal(params.id, user.id) },

  { method: 'GET', path: '/api/entries', perm: 'entries', handler: () => listEntries() },
  { method: 'GET', path: '/api/entries/:id', perm: 'entries', handler: ({ params }) => getEntry(params.id) },
  { method: 'POST', path: '/api/entries', perm: 'entries', mutate: true, handler: ({ body, user }) => receive({ ...body, userId: user.id }) },
  { method: 'POST', path: '/api/entries/:id/reverse', perm: 'entries', mutate: true, handler: ({ params, body, user }) => reverseDocument('entry', params.id, user.id, body.reason) },

  { method: 'GET', path: '/api/lots', perm: 'stock', handler: ({ query }) => listLots(query) },
  { method: 'GET', path: '/api/movements', perm: ['stock', 'movements'], handler: ({ query }) => listMovements(query) },
  { method: 'POST', path: '/api/transfers', perm: 'transfers', mutate: true, handler: ({ body, user }) => transfer({ ...body, userId: user.id }) },

  { method: 'GET', path: '/api/production', perm: 'production', handler: ({ query }) => listProductions(query) },
  { method: 'GET', path: '/api/production/:id', perm: 'production', handler: ({ params }) => getProduction(params.id) },
  { method: 'POST', path: '/api/production', perm: 'production', mutate: true, handler: ({ body, user }) => produce({ ...body, userId: body.userId || user.id }) },
  { method: 'POST', path: '/api/production/:id/reverse', perm: 'production', mutate: true, handler: ({ params, body, user }) => reverseDocument('production', params.id, user.id, body.reason) },

  { method: 'GET', path: '/api/expeditions', perm: 'expeditions', handler: () => listExpeditions() },
  { method: 'GET', path: '/api/expeditions/:id', perm: 'expeditions', handler: ({ params }) => getExpedition(params.id) },
  { method: 'POST', path: '/api/expeditions', perm: 'expeditions', mutate: true, handler: ({ body, user }) => expedite({ ...body, userId: user.id }) },
  { method: 'POST', path: '/api/expeditions/:id/reverse', perm: 'expeditions', mutate: true, handler: ({ params, body, user }) => reverseDocument('expedition', params.id, user.id, body.reason) },

  { method: 'POST', path: '/api/labels/preview', perm: 'labels', handler: ({ body, user }) => previewLabels({ filename: body.filename, buffer: Buffer.from(body.contentBase64 || '', 'base64'), user }) },
  { method: 'POST', path: '/api/labels/confirm', perm: 'labels', mutate: true, handler: ({ body, user }) => confirmLabels({ filename: body.filename, buffer: Buffer.from(body.contentBase64 || '', 'base64'), userId: user.id, onlyValid: Boolean(body.onlyValid) }) },
  { method: 'GET', path: '/api/labels', perm: 'labels', handler: () => listLabels() },
  { method: 'GET', path: '/api/labels/prints', perm: 'labels', handler: () => listPrints() },
  { method: 'POST', path: '/api/labels/unify/check', perm: 'labels', handler: ({ body, user }) => inspectUnify({ filename: body.filename, buffer: Buffer.from(body.contentBase64 || '', 'base64'), user, recordBlock: true }) },
  { method: 'POST', path: '/api/labels/unify/commit', perm: 'labels', mutate: true, handler: ({ body, user }) => commitUnify({ filename: body.filename, buffer: Buffer.from(body.contentBase64 || '', 'base64'), user, widthMm: Number(body.widthMm) || 100, heightMm: Number(body.heightMm) || 150, override: Boolean(body.override), acknowledgeSimilar: Boolean(body.acknowledgeSimilar) }) },

  { method: 'GET', path: '/api/inventory', perm: 'inventory', handler: () => listInventories() },
  { method: 'GET', path: '/api/inventory/sheet', perm: 'inventory', handler: () => countSheet() },
  { method: 'GET', path: '/api/inventory/:id', perm: 'inventory', handler: ({ params }) => getInventory(params.id) },
  { method: 'POST', path: '/api/inventory', perm: 'inventory', mutate: true, handler: ({ body, user }) => registerInventory({ ...body, userId: user.id }) },

  { method: 'GET', path: '/api/productivity', perm: 'productivity', handler: ({ query }) => productivity(query.from || monthStart(), query.to || today()) },
  { method: 'POST', path: '/api/ai/ask', perm: 'ai', handler: ({ body, user }) => ask(body.question || '', user) },
  { method: 'GET', path: '/api/audit', perm: 'settings', handler: () => q(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`) },
  { method: 'PUT', path: '/api/settings/company', perm: 'settings', mutate: true, handler: ({ body }) => { if (body.company) meta('company_name', body.company); if (body.operation) meta('operation_name', body.operation); return { company: meta('company_name'), operation: meta('operation_name') }; } },
  { method: 'POST', path: '/api/admin/reset-demo', perm: 'admin', mutate: true, handler: () => { resetDemo(); return { ok: true }; } },

  { method: 'GET', path: '/api/reports/:type', perm: 'reports', handler: ({ params, query }) => {
    const report = buildReport(params.type, query);
    if (!report) throw new HttpError(404, 'Relatório não encontrado.');
    if (query.format === 'csv' || query.format === 'xls') {
      const xls = query.format === 'xls';
      return { download: true, filename: `${params.type}.${xls ? 'xls' : 'csv'}`, contentType: xls ? 'application/vnd.ms-excel' : 'text/csv; charset=utf-8', body: xls ? toXls(report) : toCsv(report) };
    }
    return report;
  } },

  { method: 'GET', path: '/api/v1/estoque', perm: 'stock', handler: () => ({ produtos: listProducts({}), embalagens: listMaterials() }) },
  { method: 'GET', path: '/api/v1/produtos', perm: 'products', handler: () => listProducts({}) },
  { method: 'POST', path: '/api/v1/integracoes/pedidos', perm: 'expeditions', mutate: true, handler: ({ body, user }) => {
    const items = body.itens || body.items || [];
    if (!items.length) throw new HttpError(400, 'Informe os itens do pedido.');
    return items.map((item) => {
      const product = findProductByCode(item.sku || item.codigo, item.produto || item.nome);
      if (!product) throw new HttpError(404, `Produto sem cadastro: ${item.sku || item.produto}.`);
      return expedite({ productId: product.id, quantity: item.quantidade ?? item.quantity, userId: user.id, channel: body.origem || 'API', orderRef: body.pedido, notes: 'Integração de pedido' });
    });
  } },
];

export async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    });
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  const route = routes.find((item) => item.method === req.method && matchPath(item.path, url.pathname));
  if (!route) return send(res, 404, { error: 'Recurso não encontrado.' });
  try {
    const user = userFromRequest(req);
    if (route.auth !== false && !user) return send(res, 401, { error: 'Sessão expirada. Entre novamente.' });
    if (route.perm && !allows(user, route.perm, Boolean(route.mutate))) return send(res, 403, { error: 'Seu perfil não pode fazer essa operação.' });
    const raw = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : Buffer.alloc(0);
    let body = {};
    if (raw.length) {
      try { body = JSON.parse(raw.toString('utf8')); }
      catch { throw new HttpError(400, 'JSON inválido.'); }
    }
    const params = matchPath(route.path, url.pathname);
    const result = await route.handler({ user, params, query: Object.fromEntries(url.searchParams), body, req });
    if (result?.download) {
      res.writeHead(200, {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(result.body);
      return;
    }
    send(res, 200, result ?? { ok: true });
  } catch (error) {
    if (error?.alert) {
      try { logAlert(error.alert); } catch { /* alerta não pode esconder o erro */ }
    }
    const unique = String(error?.message || '').includes('UNIQUE');
    const status = unique ? 409 : (error.status || 500);
    if (status === 500) console.error(error);
    send(res, status, {
      error: unique ? 'Já existe um cadastro com esse código.' : (status === 500 ? 'Não foi possível concluir a operação.' : error.message),
      details: error.details || null,
    });
  }
}
