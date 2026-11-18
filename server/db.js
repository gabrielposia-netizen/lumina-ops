import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { now } from './lib.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(serverDir, '..');
const hosted = Boolean(process.env.VERCEL);
export const dataDir = hosted ? '/tmp/lumina-data' : path.join(root, 'data');
export const uploadDir = hosted ? '/tmp/lumina-uploads' : path.join(root, 'uploads');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const dbPath = process.env.LUMINA_DB || path.join(dataDir, 'lumina.db');
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

let txDepth = 0;

function mapRow(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    out[camel] = typeof value === 'bigint' ? Number(value) : value;
  }
  return out;
}

export function q(sql, params = []) {
  return db.prepare(sql).all(...params).map(mapRow);
}

export function one(sql, params = []) {
  return mapRow(db.prepare(sql).get(...params));
}

export function run(sql, params = []) {
  const info = db.prepare(sql).run(...params);
  return { changes: Number(info.changes ?? 0), id: Number(info.lastInsertRowid ?? 0) };
}

export function transaction(fn) {
  const outer = txDepth === 0;
  if (outer) db.exec('BEGIN IMMEDIATE');
  txDepth += 1;
  try {
    const result = fn();
    if (outer) db.exec('COMMIT');
    return result;
  } catch (error) {
    if (outer) {
      try { db.exec('ROLLBACK'); } catch { /* conexão já desfeita */ }
    }
    throw error;
  } finally {
    txDepth -= 1;
  }
}

export function audit(userId, entity, entityId, action, oldValue, newValue) {
  run(
    `INSERT INTO audit_log (user_id, occurred_at, entity, entity_id, action, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId ?? null,
      now().iso,
      entity,
      entityId == null ? null : String(entityId),
      action,
      oldValue == null ? null : JSON.stringify(oldValue),
      newValue == null ? null : JSON.stringify(newValue),
    ],
  );
}

export function logAlert({ level, code, message, entity = null, entityId = null }) {
  run(
    `INSERT INTO alerts_log (created_at, level, code, message, entity, entity_id, resolved)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [now().iso, level, code, message, entity, entityId == null ? null : String(entityId)],
  );
}

export function meta(key, value) {
  if (value === undefined) {
    return one('SELECT value FROM meta WHERE key = ?', [key])?.value ?? null;
  }
  run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)],
  );
  return value;
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','gestor','estoque','producao','expedicao','consulta')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories(id),
      UNIQUE(name, parent_id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      document TEXT,
      contact TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      internal_code TEXT NOT NULL UNIQUE,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      brand TEXT,
      category_id INTEGER REFERENCES categories(id),
      subcategory_id INTEGER REFERENCES categories(id),
      photo TEXT,
      unit TEXT NOT NULL DEFAULT 'un',
      type TEXT NOT NULL CHECK (type IN ('unitario','kit','combo')),
      combo_mode TEXT CHECK (combo_mode IN ('fisico','comercial')),
      status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
      min_stock REAL NOT NULL DEFAULT 0,
      max_stock REAL NOT NULL DEFAULT 0,
      location TEXT,
      notes TEXT,
      cost_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      stock_qty REAL NOT NULL DEFAULT 0,
      search_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compositions (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      component_id INTEGER NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL,
      UNIQUE(parent_id, component_id)
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      unit TEXT NOT NULL,
      package_unit TEXT,
      package_content REAL,
      stock_qty REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      max_stock REAL NOT NULL DEFAULT 0,
      location TEXT,
      supplier_id INTEGER REFERENCES suppliers(id),
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      search_text TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_materials (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      quantity REAL NOT NULL,
      UNIQUE(product_id, material_id)
    );

    CREATE TABLE IF NOT EXISTS lots (
      id INTEGER PRIMARY KEY,
      item_type TEXT NOT NULL CHECK (item_type IN ('product','material')),
      item_id INTEGER NOT NULL,
      lot_code TEXT NOT NULL,
      quantity REAL NOT NULL,
      received_at TEXT NOT NULL,
      expiry_date TEXT,
      supplier_id INTEGER REFERENCES suppliers(id),
      location TEXT,
      entry_id INTEGER,
      UNIQUE(item_type, item_id, lot_code)
    );

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      supplier_id INTEGER REFERENCES suppliers(id),
      invoice TEXT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'confirmada',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entry_items (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      lot_code TEXT,
      expiry_date TEXT,
      location TEXT
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      target_qty REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS shift_members (
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (shift_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      period TEXT NOT NULL DEFAULT 'dia',
      target_qty REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, period)
    );

    CREATE TABLE IF NOT EXISTS productions (
      id INTEGER PRIMARY KEY,
      order_code TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      shift_id INTEGER REFERENCES shifts(id),
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      lot_code TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'confirmada',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expeditions (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL,
      lot_code TEXT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      label_id INTEGER,
      channel TEXT,
      order_ref TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'confirmada',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      file_hash TEXT,
      source_file TEXT,
      code TEXT,
      product_name TEXT,
      product_id INTEGER REFERENCES products(id),
      quantity REAL NOT NULL,
      lot_code TEXT,
      label_date TEXT,
      order_ref TEXT,
      movement_type TEXT NOT NULL DEFAULT 'expedicao',
      status TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      processed_at TEXT,
      message TEXT,
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      balance_after REAL NOT NULL,
      lot_code TEXT,
      user_id INTEGER,
      origin TEXT,
      reference TEXT,
      production_id INTEGER,
      entry_id INTEGER,
      expedition_id INTEGER,
      inventory_id INTEGER,
      label_id INTEGER,
      notes TEXT,
      reversal_of INTEGER,
      reversed_at TEXT,
      transfer_qty REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventories (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'fechado',
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_counts (
      id INTEGER PRIMARY KEY,
      inventory_id INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      system_qty REAL NOT NULL,
      physical_qty REAL NOT NULL,
      difference REAL NOT NULL,
      justification TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      occurred_at TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT
    );

    CREATE TABLE IF NOT EXISTS alerts_log (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      resolved INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_mov_item ON movements(item_type, item_id, date);
    CREATE INDEX IF NOT EXISTS idx_mov_date ON movements(date);
    CREATE INDEX IF NOT EXISTS idx_mov_type ON movements(type);
    CREATE INDEX IF NOT EXISTS idx_mov_prod ON movements(production_id);
    CREATE INDEX IF NOT EXISTS idx_mov_exp ON movements(expedition_id);
    CREATE TABLE IF NOT EXISTS label_prints (
      id INTEGER PRIMARY KEY,
      file_hash TEXT NOT NULL,
      source_file TEXT,
      byte_size INTEGER NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      marks TEXT,
      width_mm REAL,
      height_mm REAL,
      output_labels INTEGER,
      status TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      printed_at TEXT NOT NULL,
      message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_labels_file ON labels(file_hash);
    CREATE INDEX IF NOT EXISTS idx_label_prints_hash ON label_prints(file_hash, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_label_prints_once ON label_prints(file_hash) WHERE status = 'impressa';
    CREATE INDEX IF NOT EXISTS idx_lots_item ON lots(item_type, item_id);
  `);
  if (!meta('schema_version')) meta('schema_version', '1');
  if (!meta('company_name')) meta('company_name', 'Lúmina Ops');
  if (!meta('operation_name')) meta('operation_name', 'Lúmina Hair');
}

const TABLES = [
  'inventory_counts', 'inventories', 'alerts_log', 'audit_log', 'movements', 'label_prints', 'labels',
  'expeditions', 'productions', 'entry_items', 'entries', 'lots', 'goals', 'shift_members',
  'shifts', 'product_materials', 'compositions', 'products', 'materials', 'categories',
  'suppliers', 'sessions', 'users', 'meta',
];

export function wipeDb() {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const table of TABLES) db.exec(`DELETE FROM ${table}`);
  db.exec('PRAGMA foreign_keys = ON');
  try { db.exec('DELETE FROM sqlite_sequence'); } catch { /* sem AUTOINCREMENT */ }
  meta('schema_version', '1');
  meta('company_name', 'Lúmina Ops');
  meta('operation_name', 'Lúmina Hair');
}

export function saveUpload(folder, filename, buffer) {
  const safe = String(filename || 'arquivo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-70);
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${safe}`;
  fs.writeFileSync(path.join(dir, stored), buffer);
  return `/${folder}/${stored}`;
}

export function isEmpty() {
  return !one('SELECT id FROM users LIMIT 1');
}
