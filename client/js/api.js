const TOKEN_KEY = 'lumina_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (options.raw) return response;
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.includes('/api/auth/login')) {
    clearToken();
    if (!location.hash.startsWith('#/login')) location.hash = '#/login';
  }
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível concluir a operação.');
    error.details = data.details;
    error.status = response.status;
    throw error;
  }
  return data;
}

export function can(user, perm, write = false) {
  const list = write ? user?.access?.write : user?.access?.read;
  if (!list) return false;
  return list.includes('*') || list.includes(perm);
}

export function detailText(error) {
  const lines = [error.message];
  if (Array.isArray(error.details)) {
    for (const item of error.details) {
      if (item?.name) lines.push(`${item.name}: disponível ${item.have}, necessário ${item.need}${item.unit ? ` ${item.unit}` : ''}.`);
      else if (item?.messages) lines.push(`${item.code || item.resolvedName || 'Linha'}: ${item.messages.join(', ')}`);
    }
  }
  return lines.join('\n');
}
