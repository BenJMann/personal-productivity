// Dates are stored as local strings: days as 'YYYY-MM-DD', times as 'YYYY-MM-DDTHH:mm'.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const pad = (n) => String(n).padStart(2, '0');

export function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateTimeStr(d) {
  return `${dayStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const todayStr = () => dayStr(new Date());

export function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return dayStr(d);
}

export function startOfWeek(s) {
  // Weeks start on Monday.
  const d = parseDay(s);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return dayStr(d);
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtDay(s, { withWeekday = true } = {}) {
  if (!s) return '';
  const today = todayStr();
  if (s === today) return 'Today';
  if (s === addDays(today, 1)) return 'Tomorrow';
  if (s === addDays(today, -1)) return 'Yesterday';
  const d = parseDay(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const base = `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}${sameYear ? '' : ' ' + d.getFullYear()}`;
  return withWeekday ? `${DAY_NAMES[d.getDay()]} ${base}` : base;
}

export function fmtTime(dt) {
  if (!dt) return '';
  return dt.slice(11, 16);
}

export function fmtDateTime(dt) {
  if (!dt) return '';
  return `${fmtDay(dt.slice(0, 10))} ${fmtTime(dt)}`;
}

export function fmtDuration(ms, { seconds = false } = {}) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (seconds) return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function fmtMinutes(min) {
  if (!min) return '';
  return fmtDuration(min * 60000);
}

// Deterministic hue per id so a project keeps its colour everywhere.
export function colorFor(id) {
  if (!id) return 'hsl(220 8% 55%)';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003;
  // Golden-angle spread keeps similar ids from landing on similar hues.
  return `hsl(${Math.round((h * 137.508) % 360)} 55% 62%)`;
}

export const PRIORITIES = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
];

export const cx = (...parts) => parts.filter(Boolean).join(' ');
