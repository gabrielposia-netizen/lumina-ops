import { inflateRawSync } from 'node:zlib';
import { fold, parseNumber } from './lib.js';

const HEADER_ALIASES = {
  code: ['codigo', 'sku', 'cod', 'code', 'codigo interno', 'codigo de barras', 'barras', 'ean'],
  productName: ['produto', 'nome', 'descricao', 'product', 'item'],
  quantity: ['quantidade', 'qtd', 'qtde', 'qty', 'quantity'],
  lot: ['lote', 'lot', 'batch'],
  date: ['data', 'date', 'emissao', 'dt'],
  orderRef: ['pedido', 'order', 'ordem', 'nf', 'pedido externo'],
  externalId: ['id', 'id etiqueta', 'idetiqueta', 'etiqueta', 'uid', 'identificador'],
};

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function colIndex(letters) {
  return [...letters].reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function unzip(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Arquivo Excel inválido.');
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const files = {};
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compSize = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(start, start + compSize);
    files[name] = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function sharedStrings(xml) {
  const blocks = xml.match(/<si[\s\S]*?<\/si>/g) || [];
  return blocks.map((block) => [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join(''));
}

function sheetMatrix(xml, strings) {
  const rows = [];
  for (const row of xml.match(/<row[\s\S]*?<\/row>/g) || []) {
    const map = {};
    let width = 0;
    for (const cell of row.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = /r="([A-Z]+)/.exec(cell[1]);
      const column = ref ? colIndex(ref[1]) : width;
      const type = /t="([^"]+)"/.exec(cell[1])?.[1];
      let value = '';
      if (type === 'inlineStr') {
        value = [...cell[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('');
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] ?? '';
        value = type === 's' ? strings[Number(raw)] ?? '' : decodeXml(raw);
      }
      map[column] = value;
      width = Math.max(width, column + 1);
    }
    const line = [];
    for (let index = 0; index < width; index += 1) line.push(map[index] ?? '');
    if (line.some((cell) => String(cell).trim())) rows.push(line);
  }
  return rows;
}

function xlsxToMatrix(buffer) {
  const files = unzip(buffer);
  const strings = files['xl/sharedStrings.xml'] ? sharedStrings(files['xl/sharedStrings.xml'].toString('utf8')) : [];
  const sheetName = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheetName) throw new Error('A planilha não possui aba legível.');
  return sheetMatrix(files[sheetName].toString('utf8'), strings);
}

function decodePdfString(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function pdfToText(buffer) {
  const latin = buffer.toString('latin1');
  const pieces = [];
  const marker = /stream\r?\n/g;
  let match = marker.exec(latin);
  while (match) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    let slice = buffer.subarray(start, end);
    if (slice[slice.length - 1] === 0x0a) slice = slice.subarray(0, slice.length - 1);
    if (slice[slice.length - 1] === 0x0d) slice = slice.subarray(0, slice.length - 1);
    let text = '';
    try { text = inflateRawSync(slice).toString('latin1'); } catch { text = slice.toString('latin1'); }
    for (const found of text.matchAll(/\((?:\\.|[^\\)]){1,400}\)/g)) {
      pieces.push(decodePdfString(found[0].slice(1, -1)));
    }
    match = marker.exec(latin);
  }
  return pieces.join('\n');
}

function detectDelimiter(line) {
  const scores = [
    [';', (line.match(/;/g) || []).length],
    ['\t', (line.match(/\t/g) || []).length],
    ['|', (line.match(/\|/g) || []).length],
    [',', (line.match(/,/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : ';';
}

function splitLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function textToMatrix(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.toLowerCase().startsWith('sep='));
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  return lines.map((line) => splitLine(line, delimiter));
}

function jsonToMatrix(text) {
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : data.rows || data.etiquetas || data.items;
  if (!Array.isArray(rows) || !rows.length) return [];
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [keys, ...rows.map((row) => keys.map((key) => row[key] ?? ''))];
}

function headerKey(value) {
  const name = fold(value).replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ');
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(name)) return key;
  }
  return null;
}

function looksLikeHeader(cells) {
  return cells.some((cell) => headerKey(cell));
}

function excelDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return String(value ?? '').trim();
  const date = new Date(Date.UTC(1899, 11, 30 + Math.floor(n)));
  return date.toISOString().slice(0, 10);
}

export function normalizeLabelDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  if (/^\d+(\.\d+)?$/.test(raw)) return excelDate(raw);
  return raw;
}

export function parseLabelFile({ filename, buffer }) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  let matrix = [];
  try {
    if (ext === 'json') matrix = jsonToMatrix(buffer.toString('utf8'));
    else if (ext === 'xlsx') matrix = xlsxToMatrix(buffer);
    else if (ext === 'pdf') matrix = textToMatrix(pdfToText(buffer));
    else matrix = textToMatrix(buffer.toString('utf8'));
  } catch (error) {
    const message = ext === 'pdf'
      ? 'Não consegui ler esse PDF. Exporte a etiqueta em CSV, TXT ou Excel.'
      : `Não consegui ler o arquivo (${error.message}).`;
    return { rows: [], error: message };
  }
  if (!matrix.length) {
    return { rows: [], error: 'Nenhuma linha encontrada no arquivo.' };
  }
  let start = 0;
  const columns = {};
  if (looksLikeHeader(matrix[0])) {
    matrix[0].forEach((cell, index) => {
      const key = headerKey(cell);
      if (key && columns[key] == null) columns[key] = index;
    });
    start = 1;
  } else {
    ['code', 'productName', 'quantity', 'lot', 'date'].forEach((key, index) => { columns[key] = index; });
  }
  const rows = [];
  for (let index = start; index < matrix.length; index += 1) {
    const line = matrix[index];
    const pick = (key) => (columns[key] == null ? '' : line[columns[key]] ?? '');
    const quantity = parseNumber(pick('quantity'));
    rows.push({
      line: index + 1,
      code: String(pick('code') ?? '').trim(),
      productName: String(pick('productName') ?? '').trim(),
      quantity: Number.isFinite(quantity) ? quantity : null,
      lot: String(pick('lot') ?? '').trim(),
      date: normalizeLabelDate(pick('date')),
      orderRef: String(pick('orderRef') ?? '').trim(),
      externalId: String(pick('externalId') ?? '').trim(),
    });
  }
  return { rows: rows.filter((row) => row.code || row.productName || row.quantity), error: null };
}
