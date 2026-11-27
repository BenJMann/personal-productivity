import { useMemo, useState } from 'react';
import { useBudget } from './BudgetApp';
import { fmtMoney, fmtShort, round2, daysBetween } from './model';
import { MoneyInput, TextInput, Floating, Check } from './inputs';
import Basket from './Basket';
import { fmtDay } from '../util';

function describe(p) {
  const bits = [];
  if (p.dateEst) bits.push('date estimated');
  if (p.amountEst) bits.push('amount estimated');
  return bits.join(', ');
}

// Everything about one line on one day: what really happened, what's expected, and adding more.
export default function CellPopover({ lineId, date, rect, onClose }) {
  const { budget, actions, result, today, withUndo } = useBudget();
  const line = budget.lines[lineId];
  const st = result.stats[lineId];
  const c = result.cells[`${lineId}|${date}`] || { entries: [], preds: [], missed: [] };
  const income = line.kind === 'income';
  const scheduled = line.mode === 'scheduled';

  // Unpaid expected payments anywhere in this period — a payment can count as any of them.
  const unpaid = useMemo(() => {
    if (!scheduled) return [];
    const out = [];
    for (const [k, cell] of Object.entries(result.cells)) {
      if (!k.startsWith(lineId + '|')) continue;
      out.push(...cell.preds, ...cell.missed);
    }
    return out.sort((a, b) => Math.abs(daysBetween(a.overdue || a.date, date)) - Math.abs(daysBetween(b.overdue || b.date, date)));
  }, [result, lineId, date, scheduled]);

  const here = [...c.preds, ...c.missed];
  const suggested = scheduled ? (here[0] || unpaid[0]) : line.mode === 'repeat' ? { amount: st.unit } : null;
  const [amount, setAmount] = useState(suggested && !suggested.soft ? round2(suggested.amount) : null);
  const [when, setWhen] = useState(date > today && scheduled ? today : date);
  const [note, setNote] = useState('');
  const [occ, setOcc] = useState(scheduled ? (here[0] || unpaid[0])?.key || '' : '');
  const [expect, setExpect] = useState({ dateEst: false, amountEst: true });
  const [basket, setBasket] = useState(null); // { entryId } or { new: true }
  const [editing, setEditing] = useState(null); // occurrence key being changed

  if (!line) return null;
  const paidWord = income ? 'Received' : line.mode === 'repeat' ? 'Bought' : scheduled ? 'Paid' : 'Spent';

  const addActual = (v = amount, items = null) => {
    if (v == null) return;
    withUndo(`${paidWord} ${fmtMoney(v)} · ${line.name}`, () => actions.addEntry({ lineId, date: when, amount: v, note, occ: occ || null, items }));
    onClose();
  };
  const addExpected = () => {
    if (amount == null) return;
    actions.addItem(lineId, { date: when, amount, ...expect });
    onClose();
  };
  const payOccurrence = (p) => {
    withUndo(`${paidWord} ${fmtMoney(p.amount)} · ${line.name}`, () => actions.addEntry({ lineId, date: date <= today ? date : today, amount: p.amount, occ: p.key }));
    onClose();
  };
  const removeOccurrence = (p) => {
    if (p.item) withUndo('Removed expected payment', () => actions.removeItem(lineId, p.item.id));
    else withUndo(`Skipped ${line.name} this month`, () => actions.setOverride(lineId, p.key, { skip: true }));
  };
  const changeOccurrence = (p, patch) => {
    if (p.item) actions.updateItem(lineId, p.item.id, patch);
    else actions.setOverride(lineId, p.key, patch);
  };

  return (
    <Floating rect={rect} onClose={onClose} width={360} className="cell-pop">
      <div className="pop-head">
        <strong>{line.name}</strong>
        <span className="muted">{fmtDay(date)}</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={onClose}>×</button>
      </div>

      {c.entries.length > 0 && (
        <div className="pop-section">
          {c.entries.map((e) => (
            <div key={e.id} className="pop-entry">
              <MoneyInput value={e.amount} onCommit={(v) => actions.updateEntry(e.id, { amount: v })} />
              <TextInput className="pop-note" value={e.note} placeholder="Note" onCommit={(v) => actions.updateEntry(e.id, { note: v })} />
              {!income && (
                <button className="icon-btn" title={e.items?.length ? `${e.items.length} items — edit` : 'Itemise'} onClick={() => setBasket({ entryId: e.id })}>
                  {e.items?.length ? <span className="items-badge">{e.items.length}</span> : '☰'}
                </button>
              )}
              <input type="date" className="pop-date" value={e.date} onChange={(ev) => ev.target.value && actions.updateEntry(e.id, { date: ev.target.value })} title="Move to another day" />
              <button className="icon-btn danger-text" title="Delete" onClick={() => { withUndo(`Deleted ${fmtMoney(e.amount)} · ${line.name}`, () => actions.deleteEntry(e.id)); }}>×</button>
            </div>
          ))}
          {c.entries.some((e) => e.occ) && <div className="muted small">Counts as the payment expected {c.entries.filter((e) => e.occ).map((e) => e.occ.startsWith('m:') ? `in ${e.occ.slice(-7)}` : 'here').join(', ')}.</div>}
        </div>
      )}

      {scheduled && here.map((p) => (
        <div key={p.key} className={'pop-expected' + (p.missed ? ' missed' : '')}>
          <div className="row">
            <span>{p.missed ? 'Missed' : 'Expected'} <strong>{fmtMoney(p.amount, { est: p.amountEst })}</strong></span>
            {p.overdue && <span className="chip warn">due {fmtShort(p.overdue)}</span>}
            <span className="muted small">{describe(p)}</span>
            <span className="spacer" />
            <button className="btn small primary" onClick={() => payOccurrence(p)}>{paidWord}</button>
            <button className="btn small ghost" onClick={() => setEditing(editing === p.key ? null : p.key)}>Change</button>
          </div>
          {editing === p.key && (
            <div className="pop-occ-edit">
              <label>Amount <MoneyInput value={p.amount} onCommit={(v) => changeOccurrence(p, { amount: v, amountEst: p.amountEst })} /></label>
              <label>Date <input type="date" value={p.overdue || p.date} onChange={(e) => e.target.value && changeOccurrence(p, { date: e.target.value, dateEst: p.dateEst })} /></label>
              <Check checked={p.amountEst} onChange={(v) => changeOccurrence(p, { amountEst: v, amount: p.amount })}>~ amount</Check>
              <Check checked={p.dateEst} onChange={(v) => changeOccurrence(p, { dateEst: v, date: p.overdue || p.date })}>~ date</Check>
              <span className="spacer" />
              {p.overridden && <button className="btn small ghost" onClick={() => actions.setOverride(lineId, p.key, null)}>Reset</button>}
              <button className="btn small ghost danger-text" onClick={() => removeOccurrence(p)}>{p.item ? 'Remove' : 'Skip this month'}</button>
            </div>
          )}
        </div>
      ))}

      {line.mode === 'repeat' && c.preds.length > 0 && !c.entries.length && (
        <div className="pop-expected">
          <span>Predicted purchase <strong>{fmtMoney(c.predicted)}</strong>{c.preds[0].overdue && <span className="chip warn">due {fmtShort(c.preds[0].overdue)}</span>}</span>
        </div>
      )}

      {line.mode === 'allowance' && (() => {
        const seg = st.segments?.find((s) => date >= s.start && date <= s.end);
        if (!seg) return null;
        const left = round2(seg.budget - seg.spent);
        return (
          <div className="pop-info">
            {st.plan.per === 'week' ? 'This week' : 'This month'}: spent {fmtMoney(seg.spent)} of {fmtMoney(seg.budget)} ·{' '}
            <span className={left < 0 ? 'danger-text' : 'ok-text'}>{left < 0 ? `${fmtMoney(-left)} over` : `${fmtMoney(left)} left`}</span>
          </div>
        );
      })()}

      <div className="pop-add">
        <div className="pop-add-row">
          <MoneyInput value={amount} onCommit={setAmount} onEnter={(v) => addActual(v)} autoFocus placeholder="£ amount" allowEmpty />
          <input type="date" value={when} onChange={(e) => e.target.value && setWhen(e.target.value)} />
        </div>
        <TextInput value={note} onCommit={setNote} placeholder="Note (optional)" className="pop-note-full" />
        {scheduled && unpaid.length > 0 && (
          <label className="pop-occ">
            <span className="muted small">Counts as</span>
            <select value={occ} onChange={(e) => setOcc(e.target.value)}>
              {unpaid.map((p) => (
                <option key={p.key} value={p.key}>the {fmtMoney(p.amount, { est: p.amountEst })} expected {fmtShort(p.overdue || p.date)}</option>
              ))}
              <option value="">an extra payment</option>
            </select>
          </label>
        )}
        <div className="row">
          <button className="btn small primary" disabled={amount == null} onClick={() => addActual()}>{paidWord}</button>
          {scheduled && (
            <>
              <button className="btn small" disabled={amount == null} onClick={addExpected} title="Plan a payment on this date">Expect on this date</button>
              <Check checked={expect.amountEst} onChange={(v) => setExpect({ ...expect, amountEst: v })}>~ amount</Check>
              <Check checked={expect.dateEst} onChange={(v) => setExpect({ ...expect, dateEst: v })}>~ date</Check>
            </>
          )}
          {!income && !scheduled && <button className="btn small ghost" onClick={() => setBasket({ new: true })}>Itemise…</button>}
        </div>
      </div>

      {basket && (
        <Basket
          lineId={lineId}
          initial={basket.entryId ? budget.entries[basket.entryId]?.items || [] : []}
          onClose={() => setBasket(null)}
          onSave={(items, total) => {
            if (basket.entryId) actions.updateEntry(basket.entryId, { items, amount: total });
            else addActual(total, items);
          }}
        />
      )}
    </Floating>
  );
}
