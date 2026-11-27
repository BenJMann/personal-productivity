// Every change to state.budget. Mixed into the store's actions (see store.js).
import { uid, addDays, todayStr } from '../util';
import { emptyBudget, newPeriod, startOfMonth, endOfMonth, nextMonthStart, planFor, defaultPlan, round2, findGoodByAlias, normName } from './model';

export function makeBudgetActions(update) {
  const B = (fn) => update((s) => {
    if (!s.budget) s.budget = emptyBudget();
    fn(s.budget);
  });

  const logPrice = (b, g, price, source, receiptId) => {
    if (g.composite || round2(price) === round2(g.price || 0)) return;
    b.priceHistory.push({ id: uid(), goodId: g.id, date: todayStr(), old: g.price || null, price: round2(price), source, receiptId: receiptId || null }); // a first price isn't a change
    g.price = round2(price);
  };

  const actions = {
    // Replaces the whole budget (used by undo).
    setBudget(budget) {
      update((s) => { s.budget = budget; });
    },

    // Makes sure there's a period covering today, adding calendar months as time passes.
    ensurePeriods(today = todayStr()) {
      B((b) => {
        if (!b.periods.length) b.periods.push(newPeriod(startOfMonth(today), endOfMonth(today)));
        let last = b.periods[b.periods.length - 1];
        while (last.end < today) {
          const start = addDays(last.end, 1);
          last = newPeriod(start, endOfMonth(start));
          b.periods.push(last);
        }
      });
    },
    updatePeriod(id, patch) {
      B((b) => { const p = b.periods.find((x) => x.id === id); if (p) Object.assign(p, patch); });
    },
    // The latest period ends the day before `date`; a new one runs from `date` to the end of next month.
    startNewMonth(date, { opening = null, name } = {}) {
      let id = null;
      B((b) => {
        const cur = b.periods[b.periods.length - 1];
        if (!cur || date <= cur.start || date > cur.end) return;
        const p = newPeriod(date, endOfMonth(nextMonthStart(date)));
        if (name) p.name = name;
        p.opening = opening;
        p.splitFrom = cur.end;
        cur.end = addDays(date, -1);
        b.periods.push(p);
        id = p.id;
      });
      return id;
    },
    // Folds the latest period back into the one before. Real spending is dated so nothing is lost;
    // plan changes made only for the undone month are dropped.
    undoNewMonth() {
      B((b) => {
        const p = b.periods[b.periods.length - 1];
        const prev = b.periods[b.periods.length - 2];
        if (!p?.splitFrom || !prev) return;
        prev.end = p.splitFrom;
        b.periods.pop();
        for (const l of Object.values(b.lines)) if (l.plans) delete l.plans[p.id];
        let last = prev;
        const today = todayStr();
        while (last.end < today) {
          const start = addDays(last.end, 1);
          last = newPeriod(start, endOfMonth(start));
          b.periods.push(last);
        }
      });
    },

    addGroup(name) {
      const id = uid();
      B((b) => { b.groups[id] = { id, name, order: Object.keys(b.groups).length }; });
      return id;
    },
    updateGroup(id, patch) {
      B((b) => { if (b.groups[id]) Object.assign(b.groups[id], patch); });
    },
    deleteGroup(id) {
      B((b) => {
        delete b.groups[id];
        for (const l of Object.values(b.lines)) if (l.groupId === id) l.groupId = null;
      });
    },
    moveGroup(id, dir) {
      B((b) => {
        const list = Object.values(b.groups).sort((x, y) => x.order - y.order);
        const i = list.findIndex((g) => g.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        list.forEach((g, k) => { g.order = k; });
      });
    },

    addLine({ periodId, plan, ...fields }) {
      const id = uid();
      B((b) => {
        const line = {
          id, name: 'New line', kind: 'expense', mode: 'scheduled', groupId: null, from: null, to: null,
          plans: {}, items: [], overrides: {}, order: Date.now(), createdAt: new Date().toISOString(), ...fields,
        };
        line.plans[periodId] = { ...defaultPlan(line.mode), ...(plan || {}) };
        b.lines[id] = line;
      });
      return id;
    },
    updateLine(id, patch) {
      B((b) => {
        const l = b.lines[id];
        if (!l) return;
        if (patch.mode && patch.mode !== l.mode) l.plans = {}; // plans don't translate between modes
        Object.assign(l, patch);
      });
    },
    // Changes this period's plan; later periods without their own plan inherit it.
    updatePlan(lineId, periodId, patch) {
      B((b) => {
        const l = b.lines[lineId];
        if (!l) return;
        const base = planFor(b, l, periodId);
        l.plans[periodId] = { ...defaultPlan(l.mode), ...JSON.parse(JSON.stringify(base)), ...patch };
      });
    },
    deleteLine(id) {
      B((b) => {
        delete b.lines[id];
        for (const e of Object.values(b.entries)) if (e.lineId === id) delete b.entries[e.id];
        for (const g of Object.values(b.goods)) if (g.lineId === id) g.lineId = null;
      });
    },
    // Moves a column left/right among the visible columns of its section.
    moveLine(id, dir, siblingIds) {
      B((b) => {
        const i = siblingIds.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= siblingIds.length) return;
        const ids = [...siblingIds];
        [ids[i], ids[j]] = [ids[j], ids[i]];
        const orders = siblingIds.map((x) => b.lines[x].order).sort((x, y) => x - y);
        ids.forEach((x, k) => { b.lines[x].order = orders[k]; });
      });
    },

    // One-off planned payments for a scheduled line.
    addItem(lineId, item) {
      const id = uid();
      B((b) => { const l = b.lines[lineId]; if (l) (l.items ||= []).push({ id, amount: 0, dateEst: false, amountEst: false, ...item }); });
      return id;
    },
    updateItem(lineId, itemId, patch) {
      B((b) => { const it = b.lines[lineId]?.items?.find((x) => x.id === itemId); if (it) Object.assign(it, patch); });
    },
    removeItem(lineId, itemId) {
      B((b) => {
        const l = b.lines[lineId];
        if (l) l.items = l.items.filter((x) => x.id !== itemId);
      });
    },
    // Changes (or skips) one month's occurrence of a monthly payment. patch null clears it.
    setOverride(lineId, key, patch) {
      B((b) => {
        const l = b.lines[lineId];
        if (!l) return;
        l.overrides ||= {};
        if (patch === null) delete l.overrides[key];
        else l.overrides[key] = { ...(l.overrides[key] || {}), ...patch };
      });
    },

    addEntry(fields) {
      const id = uid();
      B((b) => {
        b.entries[id] = { id, lineId: null, date: todayStr(), note: '', occ: null, items: null, receiptId: null, createdAt: new Date().toISOString(), ...fields, amount: round2(fields.amount || 0) };
      });
      return id;
    },
    updateEntry(id, patch) {
      B((b) => {
        const e = b.entries[id];
        if (!e) return;
        Object.assign(e, patch);
        if (patch.amount != null) e.amount = round2(patch.amount);
      });
    },
    deleteEntry(id) {
      B((b) => { delete b.entries[id]; });
    },

    addGood(fields) {
      const id = uid();
      B((b) => {
        b.goods[id] = { id, name: 'New item', price: 0, unit: '', lineId: null, aliases: [], composite: false, components: [], createdAt: new Date().toISOString(), ...fields };
        if (!b.goods[id].composite && b.goods[id].price) b.priceHistory.push({ id: uid(), goodId: id, date: todayStr(), old: null, price: b.goods[id].price, source: fields.source || 'manual' });
        delete b.goods[id].source;
      });
      return id;
    },
    updateGood(id, patch) {
      B((b) => {
        const g = b.goods[id];
        if (!g) return;
        const { price, ...rest } = patch;
        Object.assign(g, rest);
        if (price != null) logPrice(b, g, price, 'manual');
      });
    },
    deleteGood(id) {
      B((b) => {
        delete b.goods[id];
        for (const g of Object.values(b.goods)) if (g.components) g.components = g.components.filter((c) => c.goodId !== id);
        for (const l of Object.values(b.lines)) for (const p of Object.values(l.plans || {})) if (p.goodId === id) p.goodId = null;
      });
    },
    addAlias(goodId, alias) {
      B((b) => {
        const g = b.goods[goodId];
        if (g && alias && !(g.aliases ||= []).some((a) => normName(a) === normName(alias))) g.aliases.push(alias);
      });
    },
    removeAlias(goodId, alias) {
      B((b) => { const g = b.goods[goodId]; if (g) g.aliases = g.aliases.filter((a) => a !== alias); });
    },

    updateSettings(patch) {
      B((b) => { Object.assign(b.settings, patch); });
    },

    addReceipt(fields) {
      const id = uid();
      B((b) => { b.receipts[id] = { id, status: 'reading', createdAt: new Date().toISOString(), items: [], ...fields }; });
      return id;
    },
    updateReceipt(id, patch) {
      B((b) => { if (b.receipts[id]) Object.assign(b.receipts[id], patch); });
    },
    deleteReceipt(id) {
      B((b) => { delete b.receipts[id]; });
    },
    // Turns a reviewed receipt into goods, prices, aliases and one entry per budget line.
    // rows: [{ text, name, qty, price, goodId | 'new' | null, save, alias, updatePrice, lineId }]
    fileReceipt(id, { date, rows }) {
      B((b) => {
        const r = b.receipts[id];
        if (!r) return;
        const perLine = {};
        for (const row of rows) {
          let goodId = row.goodId;
          const unitPrice = row.qty ? row.price / row.qty : row.price;
          if (goodId === 'new' && row.save) {
            const existing = findGoodByAlias(b, row.name);
            if (existing) goodId = existing.id;
            else {
              goodId = uid();
              b.goods[goodId] = { id: goodId, name: row.name, price: round2(unitPrice), unit: '', lineId: row.lineId || null, aliases: [], composite: false, components: [], createdAt: new Date().toISOString() };
              b.priceHistory.push({ id: uid(), goodId, date, old: null, price: round2(unitPrice), source: 'receipt', receiptId: id });
            }
          }
          const g = b.goods[goodId];
          if (g) {
            if (row.alias && row.text && normName(row.text) !== normName(g.name) && !(g.aliases ||= []).some((a) => normName(a) === normName(row.text))) g.aliases.push(row.text);
            if (row.updatePrice && unitPrice > 0) {
              const before = b.priceHistory.length;
              logPrice(b, g, unitPrice, 'receipt', id);
              if (b.priceHistory.length > before) b.priceHistory[b.priceHistory.length - 1].date = date;
            }
            if (!g.lineId && row.lineId) g.lineId = row.lineId;
          }
          const key = row.lineId || '';
          (perLine[key] ||= []).push({ goodId: g ? g.id : null, name: g ? g.name : row.name || row.text, qty: row.qty || 1, price: round2(row.price) });
        }
        const entryIds = [];
        for (const [lineId, items] of Object.entries(perLine)) {
          if (!lineId || !b.lines[lineId]) continue;
          const eid = uid();
          b.entries[eid] = {
            id: eid, lineId, date, amount: round2(items.reduce((s, x) => s + x.price, 0)), note: r.store || 'Receipt', occ: null,
            items, receiptId: id, createdAt: new Date().toISOString(),
          };
          entryIds.push(eid);
        }
        Object.assign(r, { status: 'filed', filedAt: new Date().toISOString(), entryIds, date });
      });
    },
  };
  return actions;
}
