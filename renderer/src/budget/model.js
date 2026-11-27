// Budget data model and the pure calculations behind every budget screen.
//
// A "month" is a budget period: { id, name, start, end, opening }. Periods are contiguous and
// usually start on payday, so they rarely match calendar months. Starting a new month splits the
// current period: the old one ends the day before, the new one runs to the end of the next month.
//
// A line is one column of the month grid (an expense or an income). How it predicts spending
// depends on its mode:
//   repeat     — bought every N days at a unit cost (e.g. a pack of something). Predictions restart
//                from the last real purchase.
//   scheduled  — expected payments on dates: repeating monthly templates and/or one-off items. Date
//                and amount can each be marked as estimates. Income lines are always scheduled.
//   allowance  — a budget per week or per month; real spends land on any day.
// Settings that you tweak month to month live in line.plans[periodId] and carry forward to later
// months until changed. Real money spent/received is an entry: { id, lineId, date, amount, ... }.
import { uid, addDays, parseDay, dayStr, startOfWeek, MONTH_NAMES } from '../util';

export const emptyBudget = () => ({
  periods: [],
  groups: {}, // id -> { id, name, order }
  lines: {},
  entries: {},
  goods: {}, // id -> { id, name, price, unit, lineId, aliases: [], composite, components: [{ goodId, qty }] }
  priceHistory: [], // { id, goodId, date, old, price, source: 'manual' | 'receipt', receiptId }
  receipts: {},
  settings: { visionModel: 'qwen3-vl:4b-instruct' },
});

export const MODES = {
  repeat: { label: 'Recurring purchase', hint: 'Bought every few days at a unit cost' },
  scheduled: { label: 'Scheduled', hint: 'Bills, subscriptions, donations: expected on dates' },
  allowance: { label: 'Allowance', hint: 'A budget per week or month, spent on any day' },
};

export function defaultPlan(mode) {
  if (mode === 'repeat') return { goodId: null, unitCost: 0, qty: 1, every: 3, anchor: null };
  if (mode === 'allowance') return { amount: 0, per: 'week' };
  return { monthly: [] };
}

// ---- money ----

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function fmtMoney(n, { sign = false, est = false } = {}) {
  if (n == null || Number.isNaN(n)) return '';
  const r = round2(Math.abs(n));
  const body = r.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
  const prefix = n < -0.004 ? '−' : sign && n > 0.004 ? '+' : '';
  return `${prefix}${est ? '~' : ''}£${body}`;
}

// Accepts "12", "£12.50", "1,200" and simple sums like "3.20+4.50".
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  const clean = String(s ?? '').replace(/[£,\s]/g, '');
  if (!clean) return null;
  if (!/^[-+]?[\d.]+([+-][\d.]+)*$/.test(clean)) return null;
  const total = clean.match(/[-+]?[\d.]+/g).reduce((a, x) => a + Number(x), 0);
  return Number.isFinite(total) ? round2(total) : null;
}

// ---- dates & periods ----

export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
export const startOfMonth = (s) => s.slice(0, 8) + '01';
export function endOfMonth(s) {
  const d = parseDay(s);
  return dayStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
export const nextMonthStart = (s) => addDays(endOfMonth(s), 1);

export function daysOf(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// Late-month paydays usually fund the following month, so name the period after that one.
export function defaultPeriodName(start) {
  const d = parseDay(start);
  const m = d.getDate() > 20 ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : d;
  return `${MONTH_NAMES[m.getMonth()]} ${m.getFullYear()}`;
}

export function newPeriod(start, end) {
  return { id: uid(), name: defaultPeriodName(start), start, end, opening: null };
}

export function fmtShort(s) {
  const d = parseDay(s);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}

export const periodRange = (p) => `${fmtShort(p.start)} – ${fmtShort(p.end)}`;
export const periodIndex = (budget, id) => budget.periods.findIndex((p) => p.id === id);
export const periodAt = (budget, day) => budget.periods.find((p) => day >= p.start && day <= p.end) || null;

// ---- lines, plans, goods ----

export function planFor(budget, line, periodId) {
  const idx = periodIndex(budget, periodId);
  for (let i = idx; i >= 0; i--) {
    const pl = line.plans?.[budget.periods[i].id];
    if (pl) return pl;
  }
  const later = budget.periods.find((p) => line.plans?.[p.id]);
  return later ? line.plans[later.id] : defaultPlan(line.mode);
}

export function goodPrice(budget, id, seen = []) {
  const g = budget.goods[id];
  if (!g || seen.includes(id)) return 0;
  if (!g.composite) return g.price || 0;
  return round2((g.components || []).reduce((s, c) => s + (c.qty || 0) * goodPrice(budget, c.goodId, [...seen, id]), 0));
}

export function repeatUnit(budget, plan) {
  const base = plan.goodId && budget.goods[plan.goodId] ? goodPrice(budget, plan.goodId) : plan.unitCost || 0;
  return round2(base * (plan.qty || 1));
}

export const sortedGroups = (budget) => Object.values(budget.groups).sort((a, b) => a.order - b.order);
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

function hasEntriesIn(budget, line, period) {
  return Object.values(budget.entries).some((e) => e.lineId === line.id && e.date >= period.start && e.date <= period.end)
    || (line.items || []).some((it) => it.date >= period.start && it.date <= period.end);
}

export function lineVisible(budget, line, period) {
  if (line.archived) return false;
  const inRange = (!line.from || line.from <= period.end) && (!line.to || line.to >= period.start);
  return inRange || hasEntriesIn(budget, line, period);
}

// Columns in display order: income first, then each group, then ungrouped expenses.
export function columnsFor(budget, period) {
  const lines = Object.values(budget.lines).filter((l) => lineVisible(budget, l, period)).sort(byOrder);
  const sections = [];
  const income = lines.filter((l) => l.kind === 'income');
  if (income.length) sections.push({ id: 'income', name: 'Income', income: true, lines: income });
  for (const g of sortedGroups(budget)) {
    const ls = lines.filter((l) => l.kind !== 'income' && l.groupId === g.id);
    if (ls.length) sections.push({ id: g.id, name: g.name, group: g, lines: ls });
  }
  const loose = lines.filter((l) => l.kind !== 'income' && !budget.groups[l.groupId]);
  if (loose.length) sections.push({ id: 'none', name: sections.length ? 'Other' : '', lines: loose });
  return sections;
}

// ---- predictions ----

// Weeks (Mon–Sun) or the whole period, each with its share of an allowance.
export function allowanceSegments(plan, period) {
  const segs = [];
  if (plan.per === 'week') {
    for (let s = period.start; s <= period.end;) {
      const weekEnd = addDays(startOfWeek(s), 6);
      const e = weekEnd < period.end ? weekEnd : period.end;
      const days = daysBetween(s, e) + 1;
      segs.push({ start: s, end: e, days, budget: round2(((plan.amount || 0) * days) / 7) });
      s = addDays(e, 1);
    }
  } else {
    segs.push({ start: period.start, end: period.end, days: daysBetween(period.start, period.end) + 1, budget: plan.amount || 0 });
  }
  return segs;
}

function clampToMonth(ym, day) {
  const last = Number(endOfMonth(ym + '-01').slice(8));
  return `${ym}-${String(Math.min(Math.max(1, day || 1), last)).padStart(2, '0')}`;
}

function monthsOverlapping(period) {
  const out = [];
  for (let m = startOfMonth(period.start); m <= period.end; m = nextMonthStart(m)) out.push(m.slice(0, 7));
  return out;
}

// Every expected occurrence of a scheduled line in a period, before checking what's been paid.
export function scheduledOccurrences(budget, line, plan, period) {
  const out = [];
  const ok = (d) => d >= period.start && d <= period.end && (!line.from || d >= line.from) && (!line.to || d <= line.to);
  for (const t of plan.monthly || []) {
    for (const ym of monthsOverlapping(period)) {
      const key = `m:${t.id}:${ym}`;
      const ov = line.overrides?.[key] || {};
      const date = ov.date || clampToMonth(ym, t.day);
      if (!ok(date)) continue;
      out.push({
        key, date, template: t, skipped: !!ov.skip, overridden: !!(ov.date || ov.amount != null),
        amount: ov.amount ?? t.amount ?? 0,
        dateEst: ov.date ? !!ov.dateEst : !!t.dateEst,
        amountEst: ov.amount != null ? !!ov.amountEst : !!t.amountEst,
      });
    }
  }
  for (const it of line.items || []) {
    if (it.date >= period.start && it.date <= period.end) {
      out.push({ key: `i:${it.id}`, date: it.date, item: it, amount: it.amount || 0, dateEst: !!it.dateEst, amountEst: !!it.amountEst });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Predicted (not yet real) money for a line in a period. Anything predicted for a day that has
// already passed moves to today while the period is current, or counts as missed once it's over.
function predictionsFor(budget, line, plan, period, today, entries) {
  const out = [];
  const current = today >= period.start && today <= period.end;
  const over = today > period.end;
  const within = (d) => (!line.from || d >= line.from) && (!line.to || d <= line.to);

  if (line.mode === 'repeat') {
    if (over) return out;
    const unit = repeatUnit(budget, plan);
    const every = Math.max(1, Math.round(plan.every || 1));
    const last = [...entries].reverse().find((e) => e.date <= period.end);
    let d = last ? addDays(last.date, every) : plan.anchor || line.from || period.start;
    if (d < period.start) d = addDays(d, Math.ceil(daysBetween(d, period.start) / every) * every);
    let overdue = null;
    if (current && d < today) { overdue = d; d = today; }
    for (; d <= period.end; d = addDays(d, every)) {
      if (!within(d)) continue;
      out.push({ key: `r:${d}`, date: d, amount: unit, overdue, dateEst: true });
      overdue = null;
    }
    return out;
  }

  if (line.mode === 'allowance') {
    for (const seg of allowanceSegments(plan, period)) {
      if (seg.end < today) continue;
      const spent = entries.filter((e) => e.date >= seg.start && e.date <= seg.end).reduce((s, e) => s + e.amount, 0);
      const left = Math.max(0, seg.budget - spent);
      const from = seg.start > today ? seg.start : today;
      const days = daysOf(from, seg.end).filter(within);
      for (const d of days) out.push({ key: `a:${d}`, date: d, amount: left / days.length, soft: true, amountEst: true });
    }
    return out;
  }

  const paid = new Set(entries.map((e) => e.occ).filter(Boolean));
  for (const o of scheduledOccurrences(budget, line, plan, period)) {
    if (o.skipped || paid.has(o.key)) continue;
    const p = { ...o };
    if (p.date < today) {
      if (current) { p.overdue = p.date; p.date = today; } else if (over) p.missed = true;
    }
    out.push(p);
  }
  return out;
}

// ---- the whole budget, period by period ----

function entriesByLine(budget) {
  const map = {};
  for (const e of Object.values(budget.entries)) (map[e.lineId] ||= []).push(e);
  for (const k in map) map[k].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  return map;
}

function computePeriod(budget, period, opening, today, byLine) {
  const sections = columnsFor(budget, period);
  const lines = sections.flatMap((s) => s.lines);
  const days = daysOf(period.start, period.end);
  const cells = {};
  const cell = (lid, d) => (cells[`${lid}|${d}`] ||= { entries: [], actual: 0, preds: [], predicted: 0, missed: [] });
  const stats = {};

  for (const line of lines) {
    const plan = planFor(budget, line, period.id);
    const all = byLine[line.id] || [];
    const st = { plan, actual: 0, predicted: 0, missed: 0, overdue: 0, count: 0 };
    for (const e of all) {
      if (e.date < period.start || e.date > period.end) continue;
      const c = cell(line.id, e.date);
      c.entries.push(e);
      c.actual = round2(c.actual + e.amount);
      st.actual += e.amount;
      st.count++;
    }
    for (const p of predictionsFor(budget, line, plan, period, today, all)) {
      const c = cell(line.id, p.date);
      if (p.missed) { c.missed.push(p); st.missed += p.amount; continue; }
      c.preds.push(p);
      c.predicted += p.amount;
      st.predicted += p.amount;
      if (p.overdue) st.overdue++;
    }
    st.actual = round2(st.actual);
    st.predicted = round2(st.predicted);
    st.total = round2(st.actual + st.predicted);
    if (line.mode === 'allowance') {
      st.segments = allowanceSegments(plan, period).map((seg) => ({
        ...seg,
        spent: round2(all.filter((e) => e.date >= seg.start && e.date <= seg.end).reduce((s, e) => s + e.amount, 0)),
      }));
      st.budget = round2(st.segments.reduce((s, x) => s + x.budget, 0));
      // How much of the allowance should have gone by the end of today.
      const elapsed = st.segments.reduce((s, x) => {
        if (x.end <= today) return s + x.budget;
        if (x.start > today) return s;
        return s + (x.budget * (daysBetween(x.start, today) + 1)) / x.days;
      }, 0);
      st.pace = round2(elapsed);
    }
    if (line.mode === 'repeat') st.unit = repeatUnit(budget, plan);
    stats[line.id] = st;
  }

  let balance = opening;
  let low = null;
  const daily = days.map((date) => {
    const d = { date, aIn: 0, aOut: 0, pIn: 0, pOut: 0 };
    for (const line of lines) {
      const c = cells[`${line.id}|${date}`];
      if (!c) continue;
      if (line.kind === 'income') { d.aIn += c.actual; d.pIn += c.predicted; } else { d.aOut += c.actual; d.pOut += c.predicted; }
    }
    balance = round2(balance + d.aIn + d.pIn - d.aOut - d.pOut);
    d.balance = balance;
    if (date >= today && (!low || balance < low.balance)) low = { date, balance };
    return d;
  });

  const sum = (kind, f) => round2(lines.filter((l) => (l.kind === 'income') === (kind === 'in')).reduce((s, l) => s + stats[l.id][f], 0));
  const totals = {
    inTotal: sum('in', 'total'), inActual: sum('in', 'actual'), inPredicted: sum('in', 'predicted'),
    outTotal: sum('out', 'total'), outActual: sum('out', 'actual'), outPredicted: sum('out', 'predicted'),
  };
  const closing = daily.length ? daily[daily.length - 1].balance : opening;
  const todayRow = daily.find((d) => d.date === today);
  return {
    period, sections, lines, days, cells, stats, daily, opening, closing, totals, low,
    balanceToday: todayRow ? todayRow.balance : null,
    status: today < period.start ? 'future' : today > period.end ? 'past' : 'current',
  };
}

// Computes every period in order so each one's opening balance can default to the previous
// period's closing balance.
export function computeBudget(budget, today) {
  const byLine = entriesByLine(budget);
  const out = {};
  let prevClosing = 0;
  for (const p of budget.periods) {
    const opening = p.opening ?? prevClosing;
    const r = computePeriod(budget, p, opening, today, byLine);
    r.openingCarried = p.opening == null;
    out[p.id] = r;
    prevClosing = r.closing;
  }
  return out;
}

// What a recurring purchase would cost over a period at different frequencies (the "what if" table).
export function frequencyTable(budget, line, plan, period, today, entries) {
  return [1, 2, 3, 4, 5, 6, 7, 10, 14].map((every) => {
    const preds = predictionsFor(budget, line, { ...plan, every }, period, today, entries);
    const spent = entries.filter((e) => e.date >= period.start && e.date <= period.end).reduce((s, e) => s + e.amount, 0);
    const predicted = preds.filter((p) => !p.missed).reduce((s, p) => s + p.amount, 0);
    return { every, count: preds.length, predicted: round2(predicted), total: round2(spent + predicted) };
  });
}

export function lineEntries(budget, lineId) {
  return Object.values(budget.entries).filter((e) => e.lineId === lineId).sort((a, b) => a.date.localeCompare(b.date));
}

// ---- receipts ----

export const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function tokens(s) {
  return new Set(normName(s).split(' ').filter((t) => t.length > 1));
}

// Rough similarity between two product names, 0..1.
export function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t) || [...B].some((u) => u.length > 2 && t.length > 2 && (u.startsWith(t) || t.startsWith(u)))) hit++;
  return hit / Math.max(A.size, B.size);
}

export function findGoodByAlias(budget, text) {
  const n = normName(text);
  if (!n) return null;
  return Object.values(budget.goods).find((g) => normName(g.name) === n || (g.aliases || []).some((a) => normName(a) === n)) || null;
}

export function bestGoodMatch(budget, name) {
  let best = null;
  for (const g of Object.values(budget.goods)) {
    const score = Math.max(similarity(name, g.name), ...(g.aliases || []).map((a) => similarity(name, a)));
    if (score >= 0.6 && (!best || score > best.score)) best = { good: g, score };
  }
  return best?.good || null;
}
