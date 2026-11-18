import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root } from './db.js';
import { boot } from './boot.js';
import { handle } from './routes.js';

boot();

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8',
};

function safeFile(base, pathname) {
  const target = path.resolve(base, `.${decodeURIComponent(pathname)}`);
  const rootPath = path.resolve(base);
  if (!target.toLowerCase().startsWith(rootPath.toLowerCase())) return null;
  return target;
}

function serve(res, filePath) {
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Arquivo não encontrado.');
    return;
  }
  res.writeHead(200, {
    'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handle(req, res);
    return;
  }
  if (url.pathname.startsWith('/uploads/')) {
    serve(res, safeFile(path.join(root, 'uploads'), url.pathname.replace('/uploads', '') || '/'));
    return;
  }
  if (url.pathname.startsWith('/amostras/')) {
    serve(res, safeFile(path.join(root, 'amostras'), url.pathname.replace('/amostras', '') || '/'));
    return;
  }
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  serve(res, safeFile(path.join(root, 'client'), pathname));
});

const port = Number(process.env.PORT || 4173);
server.listen(port, () => {
  const address = `http://localhost:${port}`;
  console.log(`Lúmina Ops em ${address}`);
  if (process.env.LUMINA_OPEN === '1') {
    spawn('cmd', ['/c', 'start', '', address], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
});
