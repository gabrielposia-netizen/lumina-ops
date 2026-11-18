import { boot } from '../server/boot.js';
import { handle } from '../server/routes.js';

boot();

export default function handler(req, res) {
  const url = req.url || '/';
  if (!url.includes('?') && req.query && typeof req.query === 'object') {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key === 'path') continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) if (item != null) params.append(key, String(item));
    }
    const query = params.toString();
    if (query) req.url = `${url}?${query}`;
  }
  return handle(req, res);
}
