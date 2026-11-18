import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function round(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export function same(a, b) {
  return Math.abs(round(a) - round(b)) < 0.0001;
}

export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export function text(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

export function required(value, label) {
  const s = String(value ?? '').trim();
  if (!s) throw new HttpError(400, `Informe ${label}.`);
  return s;
}

export function positive(value, label) {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new HttpError(400, `${label} deve ser maior que zero.`);
  if (parsed > 1000000) throw new HttpError(400, `${label} está acima do limite permitido.`);
  return round(parsed);
}

export function nonNegative(value, label) {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new HttpError(400, `${label} não pode ser negativo.`);
  return round(parsed);
}

export function parseNumber(value) {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  return Number(s);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const verify = scryptSync(String(password), salt, 32);
  const current = Buffer.from(hash, 'hex');
  if (current.length !== verify.length) return false;
  return timingSafeEqual(current, verify);
}

export function now(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  let hour = pick('hour');
  if (hour === '24') hour = '00';
  const dateStr = `${pick('year')}-${pick('month')}-${pick('day')}`;
  const time = `${hour}:${pick('minute')}:${pick('second')}`;
  return { date: dateStr, time, iso: `${dateStr}T${time}` };
}

export function today() {
  return now().date;
}

export function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function firstOfPreviousMonth(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return date.toISOString().slice(0, 10);
}

export function at(date, time) {
  const current = now();
  const day = date || current.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Data inválida.');
  let clock = time || (day === current.date ? current.time : '12:00:00');
  if (/^\d{2}:\d{2}$/.test(clock)) clock = `${clock}:00`;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(clock)) throw new HttpError(400, 'Hora inválida.');
  return { date: day, time: clock, iso: `${day}T${clock}` };
}

export function monthStart(dateStr = today()) {
  return `${dateStr.slice(0, 7)}-01`;
}

export function shiftHours(start, end) {
  const toMin = (value) => {
    const [h, m] = String(value).split(':').map(Number);
    return h * 60 + (m || 0);
  };
  let mins = toMin(end) - toMin(start);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

export function sum(list) {
  return round(list.reduce((acc, value) => acc + Number(value || 0), 0));
}
