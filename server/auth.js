import { randomBytes } from 'node:crypto';
import { one, run } from './db.js';
import { HttpError, addDays, hashPassword, now, required, text, verifyPassword } from './lib.js';

export const ROLE_LABEL = {
  admin: 'Administrador',
  gestor: 'Gestor',
  estoque: 'Estoque',
  producao: 'Produção',
  expedicao: 'Expedição',
  consulta: 'Consulta',
};

const READ = {
  admin: ['*'],
  gestor: ['*'],
  consulta: ['*'],
  estoque: ['dashboard', 'products', 'kits', 'stock', 'entries', 'inventory', 'materials', 'movements', 'expeditions', 'labels', 'suppliers', 'categories'],
  producao: ['dashboard', 'products', 'kits', 'production', 'materials', 'productivity', 'shifts', 'users'],
  expedicao: ['dashboard', 'products', 'kits', 'labels', 'expeditions', 'stock', 'movements'],
};

const WRITE = {
  admin: ['*'],
  gestor: ['products', 'materials', 'entries', 'production', 'expeditions', 'labels', 'inventory', 'goals', 'shifts', 'suppliers', 'categories', 'transfers'],
  estoque: ['entries', 'expeditions', 'inventory', 'transfers', 'labels'],
  producao: ['production'],
  expedicao: ['labels', 'expeditions'],
  consulta: [],
};

export function accessFor(role) {
  return {
    read: READ[role] || [],
    write: WRITE[role] || [],
  };
}

export function canRead(user, perm) {
  const list = READ[user?.role] || [];
  return list.includes('*') || list.includes(perm);
}

export function canWrite(user, perm) {
  const list = WRITE[user?.role] || [];
  return list.includes('*') || list.includes(perm);
}

export function allows(user, perm, mutate) {
  const perms = Array.isArray(perm) ? perm : [perm];
  return perms.some((item) => (mutate ? canWrite(user, item) : canRead(user, item)));
}

export function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABEL[row.role] || row.role,
    active: row.active === 1 || row.active === true,
    access: accessFor(row.role),
  };
}

export function login(email, password) {
  const address = required(email, 'o e-mail').toLowerCase();
  const secret = required(password, 'a senha');
  const user = one('SELECT * FROM users WHERE email = ?', [address]);
  if (!user || !verifyPassword(secret, user.passwordHash)) {
    throw new HttpError(401, 'E-mail ou senha inválidos.');
  }
  if (user.active !== 1) throw new HttpError(403, 'Usuário inativo. Procure um administrador.');
  const token = randomBytes(32).toString('hex');
  const current = now();
  const expires = `${addDays(current.date, 7)}T${current.time}`;
  run('DELETE FROM sessions WHERE expires_at < ?', [current.iso]);
  run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [token, user.id, current.iso, expires],
  );
  return { token, user: publicUser(user) };
}

export function logout(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function userFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const session = one('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!session || session.expiresAt < now().iso) return null;
  const user = one('SELECT id, name, email, role, active FROM users WHERE id = ?', [session.userId]);
  if (!user || user.active !== 1) return null;
  return publicUser(user);
}

export function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function createUserRecord({ name, email, password, role }) {
  const address = required(email, 'o e-mail').toLowerCase();
  const secret = required(password, 'a senha');
  if (secret.length < 6) throw new HttpError(400, 'A senha precisa ter ao menos 6 caracteres.');
  if (!ROLE_LABEL[role]) throw new HttpError(400, 'Perfil de acesso inválido.');
  const created = run(
    `INSERT INTO users (name, email, password_hash, role, active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [required(name, 'o nome'), address, hashPassword(secret), role, now().iso],
  );
  return created.id;
}

export function setPassword(userId, password) {
  const secret = required(password, 'a senha');
  if (secret.length < 6) throw new HttpError(400, 'A senha precisa ter ao menos 6 caracteres.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(secret), userId]);
}

export { text };
