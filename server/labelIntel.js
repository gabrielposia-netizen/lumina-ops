import { inflateSync } from 'node:zlib';
import { findProductByCode, saveProduct } from './catalog.js';
import { fold } from './lib.js';

function decodePdfString(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function decodeHex(hex) {
  const upper = hex.toUpperCase();
  if (upper.startsWith('FEFF')) {
    let text = '';
    for (let index = 4; index + 3 < upper.length; index += 4) {
      const code = parseInt(upper.slice(index, index + 4), 16);
      if (code > 31) text += String.fromCharCode(code);
    }
    return text;
  }
  if (upper.length % 2 !== 0 || upper.length > 800) return '';
  let text = '';
  for (let index = 0; index < upper.length; index += 2) {
    const code = parseInt(upper.slice(index, index + 2), 16);
    if (code < 32 || code > 126) return '';
    text += String.fromCharCode(code);
  }
  return text;
}

function collectPieces(text, pieces) {
  for (const match of text.matchAll(/\((?:\\.|[^\\)]){1,240}\)/g)) {
    pieces.push(decodePdfString(match[0].slice(1, -1)));
  }
  for (const match of text.matchAll(/<([0-9A-Fa-f]{8,})>/g)) {
    const decoded = decodeHex(match[1]);
    if (decoded) pieces.push(decoded);
  }
}

function inflateStream(body) {
  try { return inflateSync(Buffer.from(body, 'latin1')).toString('latin1'); }
  catch { return body; }
}

function cmapFrom(text) {
  const map = new Map();
  for (const block of text.match(/beginbfrange[\s\S]*?endbfrange/g) || []) {
    for (const row of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g)) {
      let cid = parseInt(row[1], 16);
      const end = parseInt(row[2], 16);
      for (const dest of row[3].matchAll(/<([0-9A-Fa-f]+)>/g)) {
        if (cid > end) break;
        map.set(cid, String.fromCodePoint(parseInt(dest[1], 16)));
        cid += 1;
      }
    }
    const plain = block.replace(/\[[^\]]*\]/g, '');
    for (const row of plain.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = parseInt(row[1], 16);
      const end = parseInt(row[2], 16);
      const dest = parseInt(row[3], 16);
      for (let cid = start; cid <= end; cid += 1) map.set(cid, String.fromCodePoint(dest + (cid - start)));
    }
  }
  for (const block of text.match(/beginbfchar[\s\S]*?endbfchar/g) || []) {
    for (const row of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(row[1], 16), String.fromCodePoint(parseInt(row[2], 16)));
    }
  }
  return map;
}

function decodeHexGlyphs(hex, map) {
  if (!hex || !map?.size) return '';
  const width = hex.length % 4 === 0 ? 4 : 2;
  let out = '';
  for (let index = 0; index + width - 1 < hex.length; index += width) {
    out += map.get(parseInt(hex.slice(index, index + width), 16)) || '';
  }
  return out;
}

function textScore(text) {
  const folded = fold(text);
  let value = 0;
  for (const word of ['pedido', 'destinat', 'remetente', 'packing', 'order', 'sku', 'qty', 'tracking', 'produto']) {
    if (folded.includes(word)) value += 20;
  }
  value += (text.match(/[a-zà-ÿ]{3,}/gi) || []).length;
  return value;
}

function linesFromEncodedPage(text, maps) {
  const sample = (font) => {
    let current = '';
    let hex = '';
    for (const match of text.matchAll(/\/(F\d+)\s+[0-9.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj/g)) {
      if (match[1]) current = match[1];
      else if (current === font) hex += match[2];
    }
    return hex;
  };
  const chosen = new Map();
  const choose = (font) => {
    if (chosen.has(font)) return chosen.get(font);
    const hex = sample(font);
    const map = [...maps].sort((left, right) => textScore(decodeHexGlyphs(hex, right)) - textScore(decodeHexGlyphs(hex, left)))[0] || new Map();
    chosen.set(font, map);
    return map;
  };
  let font = '';
  let line = '';
  const lines = [];
  const flush = () => {
    if (line.trim()) lines.push(line.trim());
    line = '';
  };
  for (const match of text.matchAll(/\/(F\d+)\s+[0-9.]+\s+Tf|([-\d.]+)\s+([-\d.]+)\s+Td\s*<([0-9A-Fa-f]+)>\s*Tj|<([0-9A-Fa-f]+)>\s*Tj/g)) {
    if (match[1]) { font = match[1]; continue; }
    if (match[3] && Number(match[3]) < -8) flush();
    line += decodeHexGlyphs(match[4] || match[5], choose(font));
  }
  flush();
  return lines;
}

function encodedPdfLines(buffer) {
  const raw = buffer.toString('latin1');
  const objects = [...raw.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)];
  const order = [];
  const cmaps = new Map();
  const contents = new Map();
  for (const object of objects) {
    const id = Number(object[1]);
    const stream = object[2].match(/stream\r?\n([\s\S]*?)endstream/);
    if (!stream) continue;
    const text = inflateStream(stream[1]);
    if (text.includes('beginbfrange') || text.includes('beginbfchar')) {
      order.push({ id, kind: 'cmap' });
      cmaps.set(id, cmapFrom(text));
    } else if (text.includes(' Tj') || text.includes(' TJ')) {
      order.push({ id, kind: 'text' });
      contents.set(id, text);
    }
  }
  const lines = [];
  order.forEach((item, index) => {
    if (item.kind !== 'text') return;
    let next = order.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.kind === 'text');
    if (next < 0) next = order.length;
    const maps = order.slice(index + 1, next).filter((candidate) => candidate.kind === 'cmap').map((candidate) => cmaps.get(candidate.id));
    if (maps.length) lines.push(...linesFromEncodedPage(contents.get(item.id), maps));
  });
  return lines;
}

export function readablePdfText(buffer) {
  const raw = buffer.toString('latin1');
  const pieces = [];
  collectPieces(raw.replace(/stream\r?\n[\s\S]*?endstream/g, ' '), pieces);
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const text = inflateStream(match[1]);
    const printable = [...text].filter((char) => char >= ' ' && char <= '~').length / Math.max(text.length, 1);
    if (printable > 0.8) collectPieces(text, pieces);
  }
  pieces.push(...encodedPdfLines(buffer));
  return pieces.join('\n');
}

export function detectCarrier(buffer, filename = '') {
  const text = fold(`${filename}\n${readablePdfText(buffer)}`);
  const shopee = /\bshopee\b/.test(text);
  const shein = /\bshein\b|\bsheen\b/.test(text);
  const jet = /\bj\s*&\s*t\b|\bj&t\b|\bjt express\b|\bjete?xpress\b|\bjnt express\b/.test(text);
  const jetLayout = /destinatario/.test(text) && /remetente/.test(text) && /\bpedido\b/.test(text);
  const tiktokPack = /packing list/.test(text) && /seller sku/.test(text);
  if (shopee) return 'shopee';
  if (shein) return 'shein';
  if (jet || jetLayout || tiktokPack) return 'jet';
  return 'outra';
}

export function carrierRefusal(carrier) {
  if (carrier === 'shopee') return 'Etiqueta da Shopee não pode ser unificada. Só etiquetas da J&T entram nesse fluxo.';
  if (carrier === 'shein') return 'Etiqueta da Shein não pode ser unificada. Só etiquetas da J&T entram nesse fluxo.';
  if (carrier !== 'jet') return 'Só etiquetas da J&T podem ser unificadas. Shopee e Shein ficam de fora.';
  return null;
}

function cleanSku(value) {
  const sku = String(value || '').toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 40);
  return sku.length >= 3 ? sku : '';
}

export function productsFromLabelText(text) {
  const rows = [];
  const seen = new Set();
  const push = (code, productName, quantity) => {
    const sku = cleanSku(code);
    const name = String(productName || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!sku && name.length < 3) return;
    const key = `${sku}|${fold(name)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ code: sku, productName: name, quantity: Number(quantity) || null });
  };
  const source = String(text || '');
  for (const match of source.matchAll(/produto\s*:\s*([^|\n]{3,120})\|\s*sku\s*:\s*([A-Za-z0-9._-]{3,40})\s*\|\s*qtd\s*:\s*(\d+(?:[.,]\d+)?)/gi)) {
    push(match[2], match[1], String(match[3]).replace(',', '.'));
  }
  for (const match of source.matchAll(/\bsku\s*[:\-]\s*([A-Za-z0-9._-]{3,40})\b[^\n]{0,80}?\b(?:qtd|quantidade|qty)\s*[:\-]\s*(\d+(?:[.,]\d+)?)/gi)) {
    const around = match[0];
    const named = around.match(/\b(?:produto|item|descricao)\s*[:\-]\s*([^|]{3,80})/i);
    push(match[1], named?.[1] || '', String(match[2]).replace(',', '.'));
  }
  const lines = source.split(/\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (fold(lines[index]) !== 'qty' || fold(lines[index - 1] || '') !== 'seller sku') continue;
    const body = [];
    for (let cursor = index + 1; cursor < lines.length && !/^qty total/i.test(lines[cursor]); cursor += 1) body.push(lines[cursor]);
    if (body.length < 2) continue;
    const quantity = /^\d+$/.test(body.at(-1)) ? Number(body.pop()) : 1;
    const seller = body.length ? body.pop() : '';
    if (body.length && body.at(-1).length <= 24) body.pop();
    const code = cleanSku(seller);
    push(code && code.length >= 4 ? code : '', body.join(' '), quantity);
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (fold(lines[index]) !== 'padrao') continue;
    const nameLines = [];
    for (let cursor = index - 1; cursor >= 0 && nameLines.length < 6; cursor -= 1) {
      const line = lines[cursor];
      if (/^(order id|package id|created time|in transit|tracking|product name|seller sku|qty|packing list)\b/i.test(line)) break;
      if (/^\d{6,}$/.test(line) || line.length < 8 || !/[A-Za-zÀ-ÿ]{4,}/.test(line)) break;
      nameLines.unshift(line);
    }
    if (!nameLines.length) continue;
    const next = lines[index + 1] || '';
    const after = lines[index + 2] || '';
    let seller = '';
    let quantity = 1;
    if (/^\d{3,}$/.test(next) && /^\d{1,4}$/.test(after)) { seller = next; quantity = Number(after); }
    else if (/^\d{1,4}$/.test(next)) quantity = Number(next);
    const code = cleanSku(seller);
    push(code && code.length >= 4 ? code : '', nameLines.join(' '), quantity);
  }
  return rows;
}

export function registerMissingProducts(rows, userId) {
  const created = [];
  for (const row of rows || []) {
    const code = cleanSku(row.code);
    const name = String(row.productName || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!code && name.length < 3) continue;
    if (findProductByCode(code, name)) continue;
    const base = code || `IA-${fold(name).replace(/[^a-z0-9]+/g, '').slice(0, 20).toUpperCase()}`;
    const productName = name || `Produto ${base}`;
    let saved = null;
    for (let attempt = 0; attempt < 5 && !saved; attempt += 1) {
      const sku = attempt ? `${base.slice(0, 36)}-${attempt + 1}` : base;
      const existing = sku ? findProductByCode(sku, '') : null;
      if (!sku || (existing && fold(existing.name) === fold(productName))) break;
      if (existing) continue;
      try {
        saved = saveProduct({
          type: 'unitario',
          internalCode: sku,
          sku,
          name: productName,
          unit: 'un',
          status: 'ativo',
          minStock: 0,
          brand: 'Lúmina',
          notes: 'Cadastrado pelo Gestor IA na leitura da etiqueta.',
        }, userId);
      } catch { /* SKU repetido, tenta outro */ }
    }
    if (saved) created.push({ id: saved.id, sku: saved.sku, name: saved.name });
  }
  return created;
}
