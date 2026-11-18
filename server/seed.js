import fs from 'node:fs';
import path from 'node:path';
import { createUserRecord } from './auth.js';
import { saveCategory, saveGoal, saveMaterial, saveProduct, saveShift, saveSupplier } from './catalog.js';
import { logAlert, meta, one, run, uploadDir, wipeDb } from './db.js';
import { capacityOf } from './insights.js';
import { addDays, firstOfPreviousMonth, today } from './lib.js';
import { expedite, produce, receive, registerInventory } from './stock.js';

const PAST_MAR = [70, 66, 64, 62, 60, 58, 56, 54, 52, 50, 48, 46, 44, 50];
const PAST_SHIP = [40, 38, 36, 36, 34, 34, 32, 32, 40, 38, 36, 36, 34, 34];
const PAST_HID = [8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 6, 6, 6, 8];
const PAST_HID_SHIP = [6, 6, 5, 5, 5, 5, 5, 5, 6, 6, 5, 5, 5, 5];

function total(list) {
  return list.reduce((sum, value) => sum + value, 0);
}

function split3(qty) {
  const joao = Math.round(qty * 0.6);
  const maria = Math.round(qty * 0.25);
  const pedro = qty - joao - maria;
  if (pedro < 0) throw new Error('Divisão de produção inválida.');
  return [joao, maria, pedro];
}

function monogram(letter, color) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="28" fill="${color}"/><text x="80" y="98" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="68" font-weight="700" fill="#fffaf4">${letter}</text></svg>`);
}

export function seed() {
  if (total(PAST_MAR) !== 780 || total(PAST_SHIP) !== 500 || total(PAST_HID) !== 100 || total(PAST_HID_SHIP) !== 74) {
    throw new Error('Os planos de demonstração não fecham.');
  }
  const day = today();
  const adminId = createUserRecord({ name: 'Ana Ribeiro', email: 'admin@lumina.local', password: 'admin123', role: 'admin' });
  const users = {
    gestor: createUserRecord({ name: 'Ricardo Melo', email: 'gestor@lumina.local', password: 'gestor123', role: 'gestor' }),
    estoque: createUserRecord({ name: 'Helena Costa', email: 'estoque@lumina.local', password: 'estoque123', role: 'estoque' }),
    joao: createUserRecord({ name: 'João Almeida', email: 'producao@lumina.local', password: 'producao123', role: 'producao' }),
    camila: createUserRecord({ name: 'Camila Nunes', email: 'expedicao@lumina.local', password: 'expedicao123', role: 'expedicao' }),
    consulta: createUserRecord({ name: 'Paulo Vieira', email: 'consulta@lumina.local', password: 'consulta123', role: 'consulta' }),
    maria: createUserRecord({ name: 'Maria Souza', email: 'maria@lumina.local', password: 'lumina123', role: 'producao' }),
    carla: createUserRecord({ name: 'Carla Dias', email: 'carla@lumina.local', password: 'lumina123', role: 'producao' }),
    pedro: createUserRecord({ name: 'Pedro Lima', email: 'pedro@lumina.local', password: 'lumina123', role: 'producao' }),
  };

  const category = (name, parentId = null) => saveCategory({ name, parentId }, adminId).id;
  const tratamento = category('Tratamento');
  const limpeza = category('Limpeza');
  const kits = category('Kits');
  const finalizacao = category('Finalização');
  const cats = {
    progressivas: category('Progressivas', tratamento),
    hidratacao: category('Hidratação', tratamento),
    oleos: category('Óleos', tratamento),
    shampoo: category('Shampoo', limpeza),
    kitsTratamento: category('Kits de tratamento', kits),
    combos: category('Combos', kits),
    leavein: category('Leave-in', finalizacao),
    tratamento,
    limpeza,
    kits,
    finalizacao,
  };

  const atlas = saveSupplier({ name: 'Química Atlas', document: '12.441.908/0001-30', contact: 'Lívia Prado', phone: '(11) 4002-1919', email: 'pedidos@quimicaatlas.com', notes: 'Insumos e produtos acabados.' }, adminId);
  const serra = saveSupplier({ name: 'Embalagens Serra Verde', document: '08.332.110/0001-55', contact: 'Rafael Dias', phone: '(11) 3222-8800', email: 'serraverde@embalagens.com', notes: 'Caixas, fitas e proteção.' }, adminId);

  const material = (data) => saveMaterial({ supplierId: serra.id, ...data }, adminId);
  const materials = {
    'CX-15': material({ code: 'CX-15', name: 'Caixa 15', type: 'Caixa', unit: 'un', minStock: 800, maxStock: 4000, location: 'EMB-01', notes: 'Caixa de embarque do kit escova.' }),
    'CX-12': material({ code: 'CX-12', name: 'Caixa 12', type: 'Caixa', unit: 'un', minStock: 80, maxStock: 800, location: 'EMB-01' }),
    FITA: material({ code: 'FITA', name: 'Fita adesiva', type: 'Fita', unit: 'm', packageUnit: 'rolo', packageContent: 100, minStock: 300, maxStock: 5000, location: 'EMB-02', notes: 'Rolo de 100 metros.' }),
    BOLHA: material({ code: 'BOLHA', name: 'Plástico-bolha', type: 'Proteção', unit: 'm', packageUnit: 'rolo', packageContent: 100, minStock: 400, maxStock: 5000, location: 'EMB-03', notes: 'Rolo de 100 metros.' }),
    ETQ: material({ code: 'ETQ', name: 'Etiqueta térmica', type: 'Etiqueta', unit: 'un', minStock: 1000, maxStock: 20000, location: 'EMB-04' }),
  };

  const ids = {};
  const add = (data, color) => {
    const product = saveProduct({ brand: 'Lúmina Professional', unit: 'un', ...data }, adminId);
    ids[product.sku] = product.id;
    const photo = `/uploads/${product.sku}.svg`;
    if (!process.env.VERCEL) {
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, `${product.sku}.svg`), monogram(product.name.trim().charAt(0), color));
    }
    run('UPDATE products SET photo = ? WHERE id = ?', [photo, product.id]);
    return product;
  };

  add({ internalCode: 'PRG-001', sku: 'PROG-MAR', barcode: '7896600000011', name: 'Progressiva Marroquina', description: 'Alisamento progressivo com efeito liso prolongado. Uso profissional.', categoryId: cats.tratamento, subcategoryId: cats.progressivas, type: 'unitario', minStock: 400, maxStock: 3000, location: 'A-01-02', costPrice: 28, salePrice: 89 }, '#8f3d45');
  add({ internalCode: 'SHP-001', sku: 'SHP-ANT', barcode: '7896600000028', name: 'Shampoo Antirresíduo', description: 'Remove resíduos antes do tratamento.', categoryId: cats.limpeza, subcategoryId: cats.shampoo, type: 'unitario', minStock: 350, maxStock: 2500, location: 'A-01-04', costPrice: 12, salePrice: 39 }, '#3f6b58');
  add({ internalCode: 'MAS-001', sku: 'MAS-HID', barcode: '7896600000035', name: 'Máscara de Hidratação', description: 'Reposição de massa e brilho.', categoryId: cats.tratamento, subcategoryId: cats.hidratacao, type: 'unitario', minStock: 860, maxStock: 2500, location: 'A-02-01', costPrice: 18, salePrice: 59 }, '#a16207');
  add({ internalCode: 'OLE-001', sku: 'OLE-ARG', barcode: '7896600000042', name: 'Óleo Reparador', description: 'Finalização e selagem dos fios.', categoryId: cats.tratamento, subcategoryId: cats.oleos, type: 'unitario', minStock: 300, maxStock: 2500, location: 'A-02-03', costPrice: 15, salePrice: 49 }, '#1d4e89');
  add({ internalCode: 'SHP-002', sku: 'SHP-HID', barcode: '7896600000059', name: 'Shampoo Hidratante', description: 'Limpeza suave para rotina de hidratação.', categoryId: cats.limpeza, subcategoryId: cats.shampoo, type: 'unitario', minStock: 120, maxStock: 600, location: 'A-03-01', costPrice: 14, salePrice: 42 }, '#0f766e');
  add({ internalCode: 'LEA-001', sku: 'LEA-PRO', barcode: '7896600000066', name: 'Leave-in Proteção Térmica', description: 'Protege os fios do calor e do atrito.', categoryId: cats.finalizacao, subcategoryId: cats.leavein, type: 'unitario', minStock: 150, maxStock: 800, location: 'A-03-02', costPrice: 16, salePrice: 52 }, '#7c3a5e');
  add({
    internalCode: 'KIT-001', sku: 'KIT-MAR-001', barcode: '7896600000103', name: 'Kit Escova Progressiva Marroquina',
    description: 'Kit físico montado na operação. A expedição baixa somente o kit acabado.',
    categoryId: cats.kits, subcategoryId: cats.kitsTratamento, type: 'kit', minStock: 80, maxStock: 800, location: 'EXP-01', costPrice: 76, salePrice: 189,
    components: [
      { productId: ids['PROG-MAR'], quantity: 1 },
      { productId: ids['SHP-ANT'], quantity: 1 },
      { productId: ids['MAS-HID'], quantity: 1 },
      { productId: ids['OLE-ARG'], quantity: 1 },
    ],
    materials: [
      { materialId: materials['CX-15'].id, quantity: 1 },
      { materialId: materials.FITA.id, quantity: 0.5 },
      { materialId: materials.BOLHA.id, quantity: 1 },
    ],
  }, '#9a3412');
  add({
    internalCode: 'KIT-002', sku: 'KIT-HID-001', barcode: '7896600000110', name: 'Kit Hidratação Intensiva',
    description: 'Kit físico de hidratação, montado com caixa menor.',
    categoryId: cats.kits, subcategoryId: cats.kitsTratamento, type: 'kit', minStock: 20, maxStock: 200, location: 'EXP-02', costPrice: 63, salePrice: 159,
    components: [
      { productId: ids['SHP-HID'], quantity: 1 },
      { productId: ids['MAS-HID'], quantity: 1 },
      { productId: ids['LEA-PRO'], quantity: 1 },
      { productId: ids['OLE-ARG'], quantity: 1 },
    ],
    materials: [
      { materialId: materials['CX-12'].id, quantity: 1 },
      { materialId: materials.FITA.id, quantity: 0.4 },
      { materialId: materials.BOLHA.id, quantity: 0.7 },
    ],
  }, '#365314');
  add({
    internalCode: 'CMB-001', sku: 'CMB-DUO', barcode: '7896600000127', name: 'Combo Duo Progressiva',
    description: 'Combinação comercial: não é montada antes. Na expedição, baixam os componentes.',
    categoryId: cats.kits, subcategoryId: cats.combos, type: 'combo', comboMode: 'comercial', minStock: 0, maxStock: 0, location: '', costPrice: 68, salePrice: 199,
    components: [
      { productId: ids['PROG-MAR'], quantity: 2 },
      { productId: ids['SHP-ANT'], quantity: 1 },
    ],
    materials: [],
  }, '#44403c');

  saveShift({ name: '1º turno', startTime: '07:00', endTime: '16:00', targetQty: 180, memberIds: [users.joao, users.maria] }, adminId);
  saveShift({ name: '2º turno', startTime: '16:00', endTime: '01:00', targetQty: 80, memberIds: [users.carla, users.pedro] }, adminId);
  const shift1 = one(`SELECT id FROM shifts WHERE name = ?`, ['1º turno']).id;
  const shift2 = one(`SELECT id FROM shifts WHERE name = ?`, ['2º turno']).id;
  saveGoal({ userId: users.joao, targetQty: 100 }, adminId);
  saveGoal({ userId: users.maria, targetQty: 80 }, adminId);
  saveGoal({ userId: users.pedro, targetQty: 40 }, adminId);
  saveGoal({ userId: users.carla, targetQty: 40 }, adminId);

  const opening = firstOfPreviousMonth(day);
  const line = (sku, quantity, lotCode, expiry, location) => ({ itemType: 'product', itemId: ids[sku], quantity, lotCode, expiryDate: expiry, location });
  receive({
    date: opening, time: '09:10', supplierId: atlas.id, invoice: 'NF-10220', userId: users.estoque, notes: 'Carga inicial do mês anterior.',
    items: [
      line('PROG-MAR', 1740, 'L-PRG-A', '2028-12-01', 'A-01-02'),
      line('SHP-ANT', 1870, 'L-ANT-A', '2028-10-01', 'A-01-04'),
      line('MAS-HID', 1840, 'L-MAS-A', '2028-08-01', 'A-02-01'),
      line('MAS-HID', 200, 'L-MAS-B', '2027-01-10', 'A-02-01'),
      line('OLE-ARG', 2350, 'L-OLE-A', '2028-09-01', 'A-02-03'),
      line('SHP-HID', 240, 'L-HID-A', '2028-06-01', 'A-03-01'),
      line('LEA-PRO', 560, 'L-LEA-A', '2028-07-01', 'A-03-02'),
    ],
  });
  receive({
    date: opening, time: '11:00', supplierId: serra.id, invoice: 'NF-55890', userId: users.estoque, notes: 'Abastecimento de embalagens.',
    items: [
      { itemType: 'material', itemId: materials['CX-15'].id, quantity: 1400, lotCode: 'L-CX15-A', location: 'EMB-01' },
      { itemType: 'material', itemId: materials['CX-12'].id, quantity: 300, lotCode: 'L-CX12-A', location: 'EMB-01' },
      { itemType: 'material', itemId: materials.FITA.id, quantity: 1348, lotCode: 'L-FITA-A', location: 'EMB-02' },
      { itemType: 'material', itemId: materials.BOLHA.id, quantity: 2084, lotCode: 'L-BOLHA-A', location: 'EMB-03' },
      { itemType: 'material', itemId: materials.ETQ.id, quantity: 5000, lotCode: 'L-ETQ-A', location: 'EMB-04' },
    ],
  });

  let orderNo = 1800;
  const channels = ['Site', 'Mercado Livre', 'Shopee', 'Amazon'];
  const ship = (sku, quantity, date) => {
    orderNo += 1;
    expedite({ productId: ids[sku], quantity, userId: users.camila, date, time: '16:10', channel: channels[orderNo % channels.length], orderRef: `PED-${orderNo}` });
  };
  const make = (sku, quantity, userId, shiftId, date, time, lotCode) => {
    if (quantity <= 0) return;
    produce({ productId: ids[sku], quantity, userId, shiftId, date, time, lotCode });
  };
  const extras = {
    10: [['PROG-MAR', 20], ['SHP-ANT', 20]],
    7: [['PROG-MAR', 20], ['MAS-HID', 20], ['OLE-ARG', 15]],
    4: [['PROG-MAR', 40], ['SHP-ANT', 20], ['OLE-ARG', 15], ['SHP-HID', 40], ['LEA-PRO', 20]],
    2: [['SHP-HID', 40], ['LEA-PRO', 20], ['CMB-DUO', 30]],
  };

  for (let ago = 14; ago >= 1; ago -= 1) {
    const index = 14 - ago;
    const date = addDays(day, -ago);
    const [joaoQty, mariaQty, pedroQty] = split3(PAST_MAR[index]);
    make('KIT-MAR-001', joaoQty, users.joao, shift1, date, '08:40', `L${date.replaceAll('-', '')}`);
    make('KIT-MAR-001', mariaQty, users.maria, shift1, date, '11:10', `L${date.replaceAll('-', '')}`);
    make('KIT-MAR-001', pedroQty, users.pedro, shift2, date, '17:20', `L${date.replaceAll('-', '')}`);
    make('KIT-HID-001', PAST_HID[index], users.carla, shift2, date, '18:05', `H${date.replaceAll('-', '')}`);
    ship('KIT-MAR-001', PAST_SHIP[index], date);
    ship('KIT-HID-001', PAST_HID_SHIP[index], date);
    for (const [sku, quantity] of extras[ago] || []) ship(sku, quantity, date);
    if (ago === 2) {
      receive({ date, time: '10:20', supplierId: atlas.id, invoice: 'NF-18802', userId: users.estoque, notes: 'Reposição de progressiva.', items: [line('PROG-MAR', 200, 'L-PRG-B', '2028-12-15', 'A-01-02')] });
    }
  }

  receive({ date: day, time: '08:05', supplierId: atlas.id, invoice: 'NF-19018', userId: users.estoque, notes: 'Recebimento do dia.', items: [line('PROG-MAR', 200, 'L-PRG-HOJE', '2028-12-20', 'A-01-02')] });
  receive({ date: day, time: '08:20', supplierId: serra.id, invoice: 'NF-19044', userId: users.estoque, notes: 'Caixas recebidas hoje.', items: [{ itemType: 'material', itemId: materials['CX-15'].id, quantity: 300, lotCode: 'L-CX15-HOJE', location: 'EMB-01' }] });
  make('KIT-MAR-001', 120, users.joao, shift1, day, '09:05', '123456');
  make('KIT-MAR-001', 70, users.maria, shift1, day, '10:35', '123456');
  make('KIT-MAR-001', 30, users.pedro, shift2, day, '17:15', '123456');
  make('KIT-HID-001', 20, users.carla, shift2, day, '18:10', `H${day.replaceAll('-', '')}`);
  ship('KIT-MAR-001', 80, day);
  ship('KIT-HID-001', 10, day);

  const etq = one('SELECT id, stock_qty FROM materials WHERE code = ?', ['ETQ']);
  registerInventory({
    userId: users.estoque,
    notes: 'Contagem cíclica de etiquetas',
    counts: [{ itemType: 'material', itemId: etq.id, physicalQty: etq.stockQty - 20, justification: 'Etiquetas danificadas na impressão.' }],
  });

  const expedition = one('SELECT id FROM expeditions WHERE product_id = ? AND quantity = 80 ORDER BY id DESC LIMIT 1', [ids['KIT-MAR-001']]);
  const labelId = run(
    `INSERT INTO labels (uid, file_hash, source_file, code, product_name, product_id, quantity, lot_code, label_date, order_ref, movement_type, status, user_id, processed_at, message)
     VALUES ('ext:hist-ml-984400', 'historico', 'expedicao-anterior.csv', 'KIT-MAR-001', 'Kit Escova Progressiva Marroquina', ?, 80, 'FIFO', ?, 'PED-HIST', 'expedicao', 'confirmada', ?, ?, 'Processada na expedição do dia')`,
    [ids['KIT-MAR-001'], day, users.camila, `${day}T16:12:00`],
  ).id;
  run('UPDATE expeditions SET label_id = ? WHERE id = ?', [labelId, expedition.id]);
  run(
    `INSERT INTO labels (uid, source_file, code, product_name, quantity, lot_code, label_date, movement_type, status, user_id, processed_at, message)
     VALUES ('dup:demo:1', 'reenvio.csv', 'KIT-MAR-001', 'Kit Escova Progressiva Marroquina', 80, '123456', ?, 'expedicao', 'duplicada', ?, ?, 'Etiqueta já processada')`,
    [day, users.camila, `${day}T16:20:00`],
  );
  run(
    `INSERT INTO labels (uid, source_file, code, product_name, quantity, movement_type, status, user_id, processed_at, message)
     VALUES ('rej:demo:1', 'retorno-marketplace.csv', 'XYZ-NAO-EXISTE', 'Produto Fantasma', 4, 'expedicao', 'rejeitada', ?, ?, 'Produto sem cadastro')`,
    [users.camila, `${day}T16:22:00`],
  );
  logAlert({ level: 'warning', code: 'etiqueta_duplicada', message: 'Etiqueta já processada (KIT-MAR-001). Nenhuma nova baixa foi feita.', entity: 'label' });
  logAlert({ level: 'warning', code: 'produto_sem_cadastro', message: 'Etiqueta com produto sem cadastro: XYZ-NAO-EXISTE.', entity: 'label' });

  const expectedProducts = { 'PROG-MAR': 1000, 'SHP-ANT': 800, 'MAS-HID': 900, 'OLE-ARG': 1200, 'SHP-HID': 40, 'LEA-PRO': 400, 'KIT-MAR-001': 420, 'KIT-HID-001': 36, 'CMB-DUO': 0 };
  const expectedMaterials = { 'CX-15': 700, 'CX-12': 180, FITA: 800, BOLHA: 1000, ETQ: 4980 };
  for (const [sku, qty] of Object.entries(expectedProducts)) {
    const row = one('SELECT stock_qty FROM products WHERE sku = ?', [sku]);
    if (Math.abs(row.stockQty - qty) > 0.001) throw new Error(`Saldo divergente em ${sku}: ${row.stockQty} (esperado ${qty})`);
  }
  for (const [code, qty] of Object.entries(expectedMaterials)) {
    const row = one('SELECT stock_qty FROM materials WHERE code = ?', [code]);
    if (Math.abs(row.stockQty - qty) > 0.001) throw new Error(`Saldo divergente em ${code}: ${row.stockQty} (esperado ${qty})`);
  }
  const kit = one('SELECT * FROM products WHERE sku = ?', ['KIT-MAR-001']);
  const capacity = capacityOf(kit);
  if (capacity.max !== 700 || capacity.bottleneck?.name !== 'Caixa 15') {
    throw new Error(`Capacidade inesperada: ${capacity.max} / ${capacity.bottleneck?.name}`);
  }
  const joaoToday = one(`SELECT COALESCE(SUM(quantity), 0) AS qty FROM productions WHERE user_id = ? AND date = ? AND status = 'confirmada'`, [users.joao, day]);
  if (joaoToday.qty !== 120) throw new Error(`Produção de João hoje: ${joaoToday.qty}`);
  const lot = one(`SELECT quantity FROM lots WHERE item_type = 'product' AND item_id = ? AND lot_code = '123456'`, [kit.id]);
  if (!lot || lot.quantity < 80) throw new Error('Lote 123456 não ficou disponível para a etiqueta de exemplo.');
  meta('seeded', '1');
  return { day, capacity: capacity.max, bottleneck: capacity.bottleneck.name };
}

export function resetDemo() {
  wipeDb();
  return seed();
}
