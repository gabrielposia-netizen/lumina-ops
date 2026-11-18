import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'public');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(root, 'client'), target, { recursive: true });
fs.cpSync(path.join(root, 'amostras'), path.join(target, 'amostras'), { recursive: true });

const marks = [
  ['PROG-MAR', 'P', '#8f3d45'],
  ['SHP-ANT', 'S', '#3f6b58'],
  ['MAS-HID', 'M', '#a16207'],
  ['OLE-ARG', 'Ó', '#1d4e89'],
  ['SHP-HID', 'S', '#0f766e'],
  ['LEA-PRO', 'L', '#7c3a5e'],
  ['KIT-MAR-001', 'K', '#9a3412'],
  ['KIT-HID-001', 'K', '#365314'],
  ['CMB-DUO', 'C', '#44403c'],
];
const photos = path.join(target, 'uploads');
fs.mkdirSync(photos, { recursive: true });
for (const [sku, letter, color] of marks) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="28" fill="${color}"/><text x="80" y="98" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="68" font-weight="700" fill="#fffaf4">${letter}</text></svg>`;
  fs.writeFileSync(path.join(photos, `${sku}.svg`), svg);
}
