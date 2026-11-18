import fs from 'node:fs';
import path from 'node:path';
import { boot } from '../server/boot.js';
import { uploadDir } from '../server/db.js';
import { handle } from '../server/routes.js';

boot();

const types = {
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serveUpload(res, filename) {
  const name = path.basename(filename);
  const file = path.join(uploadDir, name);
  if (!name || !file.startsWith(uploadDir) || !fs.existsSync(file)) {
    res.statusCode = 404;
    res.end('Arquivo não encontrado');
    return;
  }
  res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
}

export default function handler(req, res) {
  const current = new URL(req.url || '/', 'http://localhost');
  const forwarded = current.searchParams.get('path');
  if (forwarded) {
    current.searchParams.delete('path');
    const query = current.searchParams.toString();
    req.url = `/api/${forwarded}${query ? `?${query}` : ''}`;
  }
  if ((req.url || '').startsWith('/api/uploads/')) {
    return serveUpload(res, req.url.split('?')[0]);
  }
  return handle(req, res);
}
