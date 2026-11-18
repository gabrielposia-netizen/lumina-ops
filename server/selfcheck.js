import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = path.join(os.tmpdir(), `lumina-selfcheck-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
process.env.LUMINA_DB = file;

const { initDb, one } = await import('./db.js');
const { seed } = await import('./seed.js');
const { ask } = await import('./insights.js');
const { confirmLabels, previewLabels } = await import('./labels.js');
const { expedite, produce, reverseDocument } = await import('./stock.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

initDb();
const summary = seed();
console.log('seed', summary);

const kit = one(`SELECT * FROM products WHERE sku = 'KIT-MAR-001'`);
const progressiva = one(`SELECT * FROM products WHERE sku = 'PROG-MAR'`);
const caixa = one(`SELECT * FROM materials WHERE code = 'CX-15'`);
const fita = one(`SELECT * FROM materials WHERE code = 'FITA'`);
const admin = one(`SELECT id, name, role FROM users WHERE email = 'admin@lumina.local'`);
const answer = ask('Quantos kits consigo produzir hoje?', admin);
assert(answer.answer.includes('700'), answer.answer);
assert(answer.answer.includes('Caixa 15'), answer.answer);
const month = ask('Quantas Progressivas entraram este mês?', admin);
assert(month.answer.includes('400'), month.answer);
const stock = ask('Quanto de Caixa 15 eu tenho?', admin);
assert(stock.answer.includes('700'), stock.answer);
const who = ask('Quem produziu mais hoje?', admin);
assert(who.answer.includes('João'), who.answer);

const csv = Buffer.from('codigo;produto;quantidade;lote;data\nKIT-MAR-001;Kit Escova Progressiva Marroquina;80;123456;18/11/2026\n', 'utf8');
const preview = previewLabels({ filename: 'amostra.csv', buffer: csv });
assert(preview.summary.ready === 1, `preview ${JSON.stringify(preview.summary)} ${preview.rows[0]?.messages}`);
confirmLabels({ filename: 'amostra.csv', buffer: csv, userId: admin.id });
const kitAfter = one('SELECT stock_qty FROM products WHERE id = ?', [kit.id]);
const progressivaAfter = one('SELECT stock_qty FROM products WHERE id = ?', [progressiva.id]);
const caixaAfter = one('SELECT stock_qty FROM materials WHERE id = ?', [caixa.id]);
assert(kitAfter.stockQty === 340, `kit ${kitAfter.stockQty}`);
assert(progressivaAfter.stockQty === 1000, `progressiva baixou no kit expedido: ${progressivaAfter.stockQty}`);
assert(caixaAfter.stockQty === 700, `caixa baixou na expedição do kit: ${caixaAfter.stockQty}`);
let duplicated = false;
try { confirmLabels({ filename: 'amostra.csv', buffer: csv, userId: admin.id }); }
catch (error) { duplicated = /já processada/i.test(error.message); }
assert(duplicated, 'duplicata não foi bloqueada');
assert(one('SELECT stock_qty FROM products WHERE id = ?', [kit.id]).stockQty === 340, 'duplicata alterou estoque');

const hid = one(`SELECT id FROM products WHERE sku = 'KIT-HID-001'`);
const made = produce({ productId: hid.id, quantity: 2, userId: admin.id, date: summary.day, time: '12:00' });
assert(made.impacts.some((item) => item.itemName.includes('Caixa 12') && item.quantity === -2), 'caixa do kit não baixou na montagem');
const fitaAfter = one('SELECT stock_qty FROM materials WHERE id = ?', [fita.id]);
assert(Math.abs(fitaAfter.stockQty - 799.2) < 0.001, `fita ${fitaAfter.stockQty}`);
reverseDocument('production', made.production.id, admin.id, 'Teste de estorno');
assert(Math.abs(one('SELECT stock_qty FROM materials WHERE id = ?', [fita.id]).stockQty - 800) < 0.001, 'estorno não devolveu a fita');

const combo = one(`SELECT id, stock_qty FROM products WHERE sku = 'CMB-DUO'`);
const comboMove = expedite({ productId: combo.id, quantity: 1, userId: admin.id });
assert(one('SELECT stock_qty FROM products WHERE id = ?', [combo.id]).stockQty === 0, 'combo comercial ganhou saldo');
assert(one('SELECT stock_qty FROM products WHERE id = ?', [progressiva.id]).stockQty === 998, 'combo não baixou progressiva');
reverseDocument('expedition', comboMove.expedition.id, admin.id, 'Desfaz teste');
assert(one('SELECT stock_qty FROM products WHERE id = ?', [progressiva.id]).stockQty === 1000, 'estorno do combo falhou');

let blocked = false;
try { produce({ productId: kit.id, quantity: 5000, userId: admin.id }); }
catch (error) { blocked = error.status === 409; }
assert(blocked, 'produção sem estoque foi aceita');
assert(one('SELECT stock_qty FROM materials WHERE id = ?', [caixa.id]).stockQty === 700, 'falha de produção alterou a caixa');

const items = [
  ...one('SELECT COUNT(*) AS n FROM products') ? [] : [],
];
for (const row of (await import('./db.js')).q(`SELECT 'product' AS item_type, id, name, stock_qty FROM products UNION ALL SELECT 'material', id, name, stock_qty FROM materials`)) {
  const ledger = one('SELECT COALESCE(SUM(quantity), 0) AS qty FROM movements WHERE item_type = ? AND item_id = ?', [row.itemType, row.id]);
  assert(Math.abs(ledger.qty - row.stockQty) < 0.001, `Livro divergente em ${row.name}: saldo ${row.stockQty}, movimentos ${ledger.qty}`);
}
console.log('selfcheck ok');
try { (await import('./db.js')).db.close(); fs.rmSync(file, { force: true }); } catch { /* arquivo temporário pode permanecer aberto */ }
