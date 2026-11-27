import { useMemo, useState } from 'react';
import { useBudget } from './BudgetApp';
import { goodPrice, fmtMoney, round2, normName } from './model';
import { MoneyInput, Modal, Check } from './inputs';

// Build a spend from saved goods ("what I got at the shop"): the total works itself out.
// items: [{ goodId, name, qty, price }] where price is the line total.
export default function Basket({ title = 'What did you get?', lineId, initial = [], onSave, onClose }) {
  const { budget, actions } = useBudget();
  const [items, setItems] = useState(() => initial.map((x) => ({ ...x })));
  const [query, setQuery] = useState('');
  const [savePrices, setSavePrices] = useState(true);

  const goods = useMemo(() => Object.values(budget.goods).sort((a, b) => {
    const pa = a.lineId === lineId ? 0 : 1;
    const pb = b.lineId === lineId ? 0 : 1;
    return pa - pb || a.name.localeCompare(b.name);
  }), [budget.goods, lineId]);
  const matches = query ? goods.filter((g) => normName(g.name).includes(normName(query)) || (g.aliases || []).some((a) => normName(a).includes(normName(query)))) : goods;
  const total = round2(items.reduce((s, x) => s + (x.price || 0), 0));

  const add = (g) => {
    setQuery('');
    setItems((list) => {
      const i = list.findIndex((x) => x.goodId === g.id);
      const unit = goodPrice(budget, g.id);
      if (i >= 0) return list.map((x, k) => (k === i ? { ...x, qty: x.qty + 1, price: round2(((x.price || 0) / (x.qty || 1)) * (x.qty + 1)) } : x));
      return [...list, { goodId: g.id, name: g.name, qty: 1, price: unit }];
    });
  };
  const addNew = () => {
    const name = query.trim();
    if (!name) return;
    const id = actions.addGood({ name, price: 0, lineId: lineId || null });
    setItems((list) => [...list, { goodId: id, name, qty: 1, price: 0 }]);
    setQuery('');
  };
  const setQty = (i, qty) => setItems((list) => list.map((x, k) => {
    if (k !== i) return x;
    const unit = (x.price || 0) / (x.qty || 1);
    return { ...x, qty, price: round2(unit * qty) };
  }).filter((x) => x.qty > 0));
  const setUnit = (i, unit) => setItems((list) => list.map((x, k) => (k === i ? { ...x, price: round2(unit * x.qty) } : x)));

  const changed = items.filter((x) => {
    const g = budget.goods[x.goodId];
    return g && !g.composite && Math.abs(round2(x.price / (x.qty || 1)) - (g.price || 0)) > 0.004;
  });

  const save = () => {
    if (savePrices) for (const x of changed) actions.updateGood(x.goodId, { price: round2(x.price / (x.qty || 1)) });
    onSave(items, total);
    onClose();
  };

  return (
    <Modal
      title={title}
      width={560}
      onClose={onClose}
      actions={(
        <>
          {changed.length > 0 && <Check checked={savePrices} onChange={setSavePrices}>Update {changed.length} saved price{changed.length > 1 ? 's' : ''}</Check>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!items.length}>Use {fmtMoney(total)}</button>
        </>
      )}
    >
      <div className="basket">
        <div className="basket-pick">
          <input
            autoFocus
            placeholder="Find or add an item…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); if (matches[0] && query) add(matches[0]); else addNew(); }
            }}
          />
          <div className="basket-goods">
            {matches.slice(0, 40).map((g) => (
              <button key={g.id} className="basket-good" onClick={() => add(g)}>
                <span>{g.name}</span>
                <span className="muted">{fmtMoney(goodPrice(budget, g.id))}</span>
              </button>
            ))}
            {query && !matches.some((g) => normName(g.name) === normName(query)) && (
              <button className="basket-good new" onClick={addNew}>+ Add “{query}” as a new item</button>
            )}
            {!goods.length && !query && <div className="muted small pad">No saved items yet — type a name to add one.</div>}
          </div>
        </div>
        <div className="basket-list">
          {items.map((x, i) => (
            <div key={i} className="basket-row">
              <span className="basket-name">{x.name}</span>
              <span className="qty">
                <button className="icon-btn" onClick={() => setQty(i, x.qty - 1)}>−</button>
                <span>{x.qty}</span>
                <button className="icon-btn" onClick={() => setQty(i, x.qty + 1)}>+</button>
              </span>
              <MoneyInput value={round2((x.price || 0) / (x.qty || 1))} onCommit={(v) => setUnit(i, v)} title="Price each" />
              <span className="basket-total">{fmtMoney(x.price)}</span>
            </div>
          ))}
          {!items.length && <div className="muted small pad">Click items on the left to add them.</div>}
          {items.length > 0 && <div className="basket-sum"><span>Total</span><strong>{fmtMoney(total)}</strong></div>}
        </div>
      </div>
    </Modal>
  );
}
