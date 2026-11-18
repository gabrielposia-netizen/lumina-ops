import { boot } from '../server/boot.js';
import { handle } from '../server/routes.js';

boot();

export default function handler(req, res) {
  const current = new URL(req.url || '/', 'http://localhost');
  const forwarded = current.searchParams.get('path');
  if (forwarded) {
    current.searchParams.delete('path');
    const query = current.searchParams.toString();
    req.url = `/api/${forwarded}${query ? `?${query}` : ''}`;
  }
  return handle(req, res);
}
