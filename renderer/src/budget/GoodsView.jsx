import { useMemo, useState } from 'react';
import { useBudget } from './BudgetApp';
import { useUI } from '../ui';
import { goodPrice, fmtMoney, fmtShort, round2, normName } from './model';
import { MoneyInput, NumberInput, TextInput } from './inputs';
import { cx } from '../util';

function LineSelect({ value, onChange }) {
  const { budget } = useBudget();
  const lines = Object.values(budget.lines).filter((l) => l.kind !== 'income' && !l.archived).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select value={budget.lines[value] ? value : ''} onChange={(e) => onChange(e.target.value || null)} title="Which budget line this usually counts towards">
      <option value="">—</option>
      {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );
}

function Trend({ goodId }) {
  const { budget } = useBudget();
  const hist = budget.priceHistory.filter((h) => h.goodId === goodId && h.old != null);
  const last = hist[hist.length - 1];
  if (!last) return null;
  const up = last.price > last.old;
  return (
    <span className={cx('chip', up ? 'danger' : 'ok')} title={`${fmtMoney(last.old)} → ${fmtMoney(last.price)} on ${fmtShort(last.date)}`}>
      {up ? '▲' : '▼'} {fmtMoney(Math.abs(last.price - last.old))}
    </span>
  );
}

function GoodRow({ g }) {
  const { budget, actions, withUndo } = useBudget();
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const usedBy = Object.values(budget.lines).filter((l) => Object.values(l.plans || {}).some((p) => p.goodId === g.id));
  const others = Object.values(budget.goods).filter((x) => x.id !== g.id).sort((a, b) => a.name.localeCompare(b.name));
  const setComponents = (components) => actions.updateGood(g.id, { components });
  return (
    <>
      <tr className={cx('b-good', g.composite && 'composite')}>
        <td>
          <div className="row">
            {g.composite && <button className="icon-btn" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>}
            <TextInput className="b-good-name" value={g.name} onCommit={(v) => v.trim() && actions.updateGood(g.id, { name: v.trim() })} />
          </div>
          {usedBy.length > 0 && <div className="muted small b-used">Used by {usedBy.map((l) => l.name).join(', ')}</div>}
        </td>
        <td>
          {g.composite ? <span className="b-composite-price" title="Worked out from its parts">{fmtMoney(goodPrice(budget, g.id))}</span>
            : <MoneyInput value={g.price} onCommit={(v) => actions.updateGood(g.id, { price: v })} />}
        </td>
        <td><TextInput className="b-unit" value={g.unit} placeholder="e.g. 30g, 4 pints" onCommit={(v) => actions.updateGood(g.id, { unit: v })} /></td>
        <td><LineSelect value={g.lineId} onChange={(v) => actions.updateGood(g.id, { lineId: v })} /></td>
        <td className="b-aliases">
          {g.composite ? <span className="muted small">{(g.components || []).length} parts</span> : (
            <>
              {(g.aliases || []).map((a) => <span key={a} className="chip mono">{a}<button className="chip-x" onClick={() => actions.removeAlias(g.id, a)}>×</button></span>)}
              <button className="icon-btn" title="Add a name as printed on receipts" onClick={async () => { const a = await ui.prompt({ title: `Receipt name for ${g.name}`, message: 'Exactly as the shop prints it, e.g. “SEMI SKMD MLK 4PT”.' }); if (a) actions.addAlias(g.id, a); }}>+</button>
            </>
          )}
        </td>
        <td><Trend goodId={g.id} /></td>
        <td>
          <button className="icon-btn danger-text" title="Delete" onClick={() => withUndo(`Deleted ${g.name}`, () => actions.deleteGood(g.id))}>×</button>
        </td>
      </tr>
      {g.composite && open && (
        <tr className="b-components">
          <td colSpan={7}>
            {(g.components || []).map((c, i) => {
              const part = budget.goods[c.goodId];
              return (
                <div key={i} className="b-component">
                  <NumberInput value={c.qty} min={0} step={0.5} onCommit={(v) => setComponents(g.components.map((x, k) => (k === i ? { ...x, qty: v } : x)))} />
                  <span>×</span>
                  <select value={c.goodId} onChange={(e) => setComponents(g.components.map((x, k) => (k === i ? { ...x, goodId: e.target.value } : x)))}>
                    {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <span className="muted">{part ? `${fmtMoney(goodPrice(budget, part.id))} each = ${fmtMoney(round2(c.qty * goodPrice(budget, part.id)))}` : 'missing'}</span>
                  <button className="icon-btn" onClick={() => setComponents(g.components.filter((_, k) => k !== i))}>×</button>
                </div>
              );
            })}
            {others.length ? (
              <button className="btn small ghost" onClick={() => setComponents([...(g.components || []), { goodId: others[0].id, qty: 1 }])}>+ Add a part</button>
            ) : <span className="muted small">Add some single items first, then build this from them.</span>}
          </td>
        </tr>
      )}
    </>
  );
}

function PriceChanges() {
  const { budget } = useBudget();
  const [goodId, setGoodId] = useState('');
  const list = budget.priceHistory.filter((h) => h.old != null && (!goodId || h.goodId === goodId) && budget.goods[h.goodId]).slice().reverse();
  const summary = useMemo(() => {
    const per = {};
    for (const h of budget.priceHistory) {
      if (!budget.goods[h.goodId]) continue;
      (per[h.goodId] ||= []).push(h);
    }
    return Object.entries(per).filter(([, hs]) => hs.length > 1).map(([id, hs]) => {
      const first = hs[0].old ?? hs[0].price;
      const now = hs[hs.length - 1].price;
      return { id, name: budget.goods[id].name, first, now, since: hs[0].date, pct: first ? ((now - first) / first) * 100 : 0, points: hs.map((h) => h.price) };
    }).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  }, [budget]);

  if (!budget.priceHistory.some((h) => h.old != null)) {
    return <div className="empty small">No price changes yet. They're recorded when you change a price here, in a shopping basket, or when a receipt shows a new price.</div>;
  }
  return (
    <>
      <div className="b-price-cards">
        {summary.map((s) => {
          const max = Math.max(...s.points);
          const min = Math.min(...s.points);
          const pts = s.points.map((p, i) => `${(i / Math.max(1, s.points.length - 1)) * 80},${22 - ((p - min) / (max - min || 1)) * 20}`).join(' ');
          return (
            <div key={s.id} className={cx('b-price-card', goodId === s.id && 'active')} onClick={() => setGoodId(goodId === s.id ? '' : s.id)}>
              <div className="b-price-name">{s.name}</div>
              <svg width="80" height="24" className="b-spark"><polyline points={pts} /></svg>
              <div><strong>{fmtMoney(s.now)}</strong> <span className={s.pct > 0 ? 'danger-text' : 'ok-text'}>{s.pct > 0 ? '+' : ''}{s.pct.toFixed(0)}%</span></div>
              <div className="muted small">from {fmtMoney(s.first)} since {fmtShort(s.since)}</div>
            </div>
          );
        })}
      </div>
      <table className="b-table">
        <thead><tr><th>Date</th><th>Item</th><th>Was</th><th>Now</th><th>Change</th><th>From</th></tr></thead>
        <tbody>
          {list.map((h) => {
            const d = h.price - h.old;
            return (
              <tr key={h.id}>
                <td>{fmtShort(h.date)}</td>
                <td>{budget.goods[h.goodId].name}</td>
                <td>{fmtMoney(h.old)}</td>
                <td>{fmtMoney(h.price)}</td>
                <td className={d > 0 ? 'danger-text' : 'ok-text'}>{fmtMoney(d, { sign: true })}{h.old ? ` (${d > 0 ? '+' : ''}${((d / h.old) * 100).toFixed(0)}%)` : ''}</td>
                <td className="muted">{h.source === 'receipt' ? 'receipt' : 'edited'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export default function GoodsView() {
  const { budget, actions } = useBudget();
  const ui = useUI();
  const [tab, setTab] = useState('items');
  const [q, setQ] = useState('');
  const goods = Object.values(budget.goods)
    .filter((g) => !q || normName(g.name).includes(normName(q)) || (g.aliases || []).some((a) => normName(a).includes(normName(q))))
    .sort((a, b) => (a.composite - b.composite) || a.name.localeCompare(b.name));
  const changes = budget.priceHistory.filter((h) => h.old != null).length;

  return (
    <div className="view">
      <div className="view-head">
        <h1>Goods & prices</h1>
        <div className="segmented">
          <button className={cx(tab === 'items' && 'active')} onClick={() => setTab('items')}>Items</button>
          <button className={cx(tab === 'changes' && 'active')} onClick={() => setTab('changes')}>Price changes{changes ? ` (${changes})` : ''}</button>
        </div>
        <span className="spacer" />
        {tab === 'items' && <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
        {tab === 'items' && <button className="btn small" onClick={async () => {
          const name = await ui.prompt({ title: 'New composite', message: 'A bundle made from other items, e.g. a weekly shop or “Rizla, milk & filters”. Its price is worked out from its parts.', placeholder: 'Name' });
          if (name) actions.addGood({ name, composite: true, components: [] });
        }}>+ Composite</button>}
        {tab === 'items' && <button className="btn small primary" onClick={async () => {
          const name = await ui.prompt({ title: 'New item', placeholder: 'e.g. Energy drink' });
          if (name) actions.addGood({ name });
        }}>+ Item</button>}
      </div>
      {tab === 'changes' ? <PriceChanges /> : !Object.keys(budget.goods).length ? (
        <div className="empty">
          <p>Save what things cost so the budget can work out spending for you.</p>
          <p className="muted small">Recurring purchases use these unit prices, shopping baskets add them up, and receipts keep them up to date.</p>
        </div>
      ) : (
        <table className="b-table b-goods">
          <thead><tr><th>Item</th><th>Price</th><th>Size</th><th>Counts towards</th><th>Receipt names</th><th>Last change</th><th /></tr></thead>
          <tbody>{goods.map((g) => <GoodRow key={g.id} g={g} />)}</tbody>
        </table>
      )}
    </div>
  );
}
