import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'public');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(root, 'client'), target, { recursive: true });
fs.cpSync(path.join(root, 'amostras'), path.join(target, 'amostras'), { recursive: true });
