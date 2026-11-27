import { useEffect, useMemo, useState } from 'react';
import { useBudget } from './BudgetApp';
import { useUI } from '../ui';
import {
  MODES, fmtMoney, fmtShort, round2, sortedGroups, goodPrice, scheduledOccurrences, frequencyTable, lineEntries, periodIndex,
} from './model';
import { MoneyInput, NumberInput, TextInput, Check } from './inputs';
import Basket from './Basket';
import { uid, fmtDay, cx } from '../util';

function RepeatPlan({ line, plan, set, st }) {
  const { budget, period, today, result } = useBudget();
  const entries = useMemo(() => lineEntries(budget, line.id), [budget, line.id]);
  const table = useMemo(() => frequencyTable(budget, line, plan, period, today, entries), [budget, line, plan, period, today, entries]);
  const goods = Object.values(budget.goods).sort((a, b) => a.name.localeCompare(b.name));
  const next = Object.entries(result.cells).filter(([k, c]) => k.startsWith(line.id + '|') && c.preds.length).map(([k]) => k.split('|')[1]).sort();
  const last = entries.filter((e) => e.date <= period.end).pop();
  return (
    <>
      <div className="form-grid">
        <label>Item</label>
        <select value={plan.goodId || ''} onChange={(e) => set({ goodId: e.target.value || null })}>
          <option value="">Custom price</option>
          {goods.map((g) => <option key={g.id} value={g.id}>{g.name} — {fmtMoney(goodPrice(budget, g.id))}{g.composite ? ' (composite)' : ''}</option>)}
        </select>
        {!plan.goodId && <label>Price</label>}
        {!plan.goodId && <MoneyInput value={plan.unitCost} onCommit={(v) => set({ unitCost: v })} />}
        <label>Quantity</label>
        <span className="row"><NumberInput value={plan.qty || 1} min={0.1} step={0.5} onCommit={(v) => set({ qty: v })} /><span className="muted">each time · {fmtMoney(st.unit)} per purchase</span></span>
        <label>Every</label>
        <span className="row"><NumberInput value={plan.every} min={1} onCommit={(v) => set({ every: Math.round(v) })} /><span className="muted">days</span></span>
        {!last && <label>First purchase</label>}
        {!last && <input type="date" value={plan.anchor || ''} min={period.start} max={period.end} onChange={(e) => set({ anchor: e.target.value || null })} />}
      </div>
      <p className="muted small">
        {last ? <>Last bought {fmtDay(last.date)}. </> : null}
        {next.length ? <>Next: {next.slice(0, 4).map(fmtShort).join(', ')}{next.length > 4 ? '…' : ''} ({next.length} more this month).</> : 'No more purchases predicted this month.'}
        {' '}Predictions restart from the day you tick a purchase.
      </p>
      <div className="section-label">What if — buying every…</div>
      <div className="b-whatif">
        {table.map((r) => (
          <button key={r.every} className={cx('b-whatif-cell', r.every === plan.every && 'active')} onClick={() => set({ every: r.every })} title={`${r.count} more purchases · ${fmtMoney(r.predicted)} still to spend`}>
            <span className="muted small">{r.every} day{r.every > 1 ? 's' : ''}</span>
            <strong>{fmtMoney(r.total)}</strong>
          </button>
        ))}
      </div>
    </>
  );
}

function ScheduledPlan({ line, plan, set, st }) {
  const { budget, actions, period, today, withUndo } = useBudget();
  const income = line.kind === 'income';
  const occurrences = scheduledOccurrences(budget, line, plan, period);
  const entries = lineEntries(budget, line.id);
  const byOcc = Object.fromEntries(entries.filter((e) => e.occ).map((e) => [e.occ, e]));
  const setTemplate = (id, patch) => set({ monthly: plan.monthly.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const word = income ? 'Received' : 'Paid';
  return (
    <>
      <div className="section-label">Repeats monthly</div>
      {(plan.monthly || []).map((t) => (
        <div key={t.id} className="b-template">
          <span className="muted">Day</span>
          <NumberInput value={t.day} min={1} onCommit={(v) => setTemplate(t.id, { day: Math.min(31, Math.round(v)) })} />
          <MoneyInput value={t.amount} onCommit={(v) => setTemplate(t.id, { amount: v })} />
          <Check checked={t.amountEst} onChange={(v) => setTemplate(t.id, { amountEst: v })} title="Amount is a guess">~ amount</Check>
          <Check checked={t.dateEst} onChange={(v) => setTemplate(t.id, { dateEst: v })} title="Date is a guess">~ date</Check>
          <button className="icon-btn" title="Remove" onClick={() => set({ monthly: plan.monthly.filter((x) => x.id !== t.id) })}>×</button>
        </div>
      ))}
      <button className="btn small ghost" onClick={() => set({ monthly: [...(plan.monthly || []), { id: uid(), day: Number((today >= period.start && today <= period.end ? today : period.start).slice(8)), amount: 0, amountEst: false, dateEst: false }] })}>+ Repeat monthly</button>

      <div className="section-label b-gap">In {period.name}</div>
      {!occurrences.length && <div className="muted small">Nothing expected this month.</div>}
      <div className="b-occ-list">
        {occurrences.map((o) => {
          const paid = byOcc[o.key];
          return (
            <div key={o.key} className={cx('b-occ', paid && 'paid', o.skipped && 'skipped')}>
              <span className="b-occ-date">{o.dateEst && !paid ? '~' : ''}{fmtShort(paid ? paid.date : o.date)}</span>
              {paid ? (
                <span><span className="ok-text">✓ {word} {fmtMoney(paid.amount)}</span>{Math.abs(paid.amount - o.amount) > 0.004 && <span className="muted small"> (expected {fmtMoney(o.amount, { est: o.amountEst })})</span>}</span>
              ) : o.skipped ? (
                <span className="muted strike">{fmtMoney(o.amount)}</span>
              ) : (
                <span>{fmtMoney(o.amount, { est: o.amountEst })}{o.date < today && <span className="chip warn">overdue</span>}{o.item && <span className="chip">one-off</span>}</span>
              )}
              <span className="spacer" />
              {paid && <button className="btn small ghost" onClick={() => withUndo('Payment removed', () => actions.deleteEntry(paid.id))}>Undo {word.toLowerCase()}</button>}
              {!paid && !o.skipped && <button className="btn small" onClick={() => withUndo(`${word} ${fmtMoney(o.amount)}`, () => actions.addEntry({ lineId: line.id, date: o.date <= today ? o.date : today, amount: o.amount, occ: o.key }))}>{word}</button>}
              {!paid && !o.skipped && !o.item && <button className="btn small ghost" onClick={() => actions.setOverride(line.id, o.key, { skip: true })}>Skip</button>}
              {o.skipped && <button className="btn small ghost" onClick={() => actions.setOverride(line.id, o.key, { skip: false })}>Restore</button>}
              {o.item && !paid && <button className="icon-btn" onClick={() => actions.removeItem(line.id, o.item.id)}>×</button>}
            </div>
          );
        })}
      </div>
      <button className="btn small ghost" onClick={() => actions.addItem(line.id, { date: today >= period.start && today <= period.end ? today : period.start, amount: 0, amountEst: true, dateEst: true })}>+ Expected payment this month only</button>
      {(line.items || []).filter((it) => it.date >= period.start && it.date <= period.end && !byOcc[`i:${it.id}`]).map((it) => (
        <div key={it.id} className="b-template">
          <input type="date" value={it.date} onChange={(e) => e.target.value && actions.updateItem(line.id, it.id, { date: e.target.value })} />
          <MoneyInput value={it.amount} onCommit={(v) => actions.updateItem(line.id, it.id, { amount: v })} />
          <Check checked={it.amountEst} onChange={(v) => actions.updateItem(line.id, it.id, { amountEst: v })}>~ amount</Check>
          <Check checked={it.dateEst} onChange={(v) => actions.updateItem(line.id, it.id, { dateEst: v })}>~ date</Check>
        </div>
      ))}
      <p className="muted small">Change a single month's date or amount by clicking it in the grid.</p>
    </>
  );
}

function AllowancePlan({ line, plan, set, st }) {
  const { today, result } = useBudget();
  return (
    <>
      <div className="form-grid">
        <label>Budget</label>
        <span className="row">
          <MoneyInput value={plan.amount} onCommit={(v) => set({ amount: v })} />
          <select value={plan.per} onChange={(e) => set({ per: e.target.value })}>
            <option value="week">per week</option>
            <option value="month">for the month</option>
          </select>
          <span className="muted">= {fmtMoney(st.budget)} this month</span>
        </span>
      </div>
      {result.status === 'current' && st.pace != null && (
        <p className={cx('small', st.actual > st.pace ? 'danger-text' : 'ok-text')}>
          By today you'd expect to have spent {fmtMoney(st.pace)}; you've spent {fmtMoney(st.actual)} — {st.actual > st.pace ? `${fmtMoney(st.actual - st.pace)} ahead of plan` : `${fmtMoney(st.pace - st.actual)} in hand`}.
        </p>
      )}
      <table className="b-mini-table">
        <thead><tr><th>{plan.per === 'week' ? 'Week' : 'Month'}</th><th>Budget</th><th>Spent</th><th>Left</th></tr></thead>
        <tbody>
          {st.segments.map((s) => {
            const left = round2(s.budget - s.spent);
            return (
              <tr key={s.start} className={cx(today >= s.start && today <= s.end && 'now', s.end < today && 'done')}>
                <td>{fmtShort(s.start)}{s.end !== s.start ? ` – ${fmtShort(s.end)}` : ''}{s.days < 7 && plan.per === 'week' ? <span className="muted small"> ({s.days}d)</span> : null}</td>
                <td>{fmtMoney(s.budget)}</td>
                <td>{fmtMoney(s.spent)}</td>
                <td className={left < 0 ? 'danger-text' : ''}>{fmtMoney(left)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Unspent money in a week that's over isn't carried forward in the forecast; overspending is.</p>
    </>
  );
}

export default function LineEditor({ id }) {
  const { budget, actions, period, result, openLine, withUndo } = useBudget();
  const ui = useUI();
  const line = budget.lines[id];
  const [basket, setBasket] = useState(null);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .b-float')) openLine(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [openLine]);

  if (!line) return null;
  const st = result.stats[id];
  const set = (patch) => actions.updatePlan(id, period.id, patch);
  const income = line.kind === 'income';
  const ownPlan = !!line.plans?.[period.id];
  const inheritsFrom = !ownPlan ? budget.periods.slice(0, periodIndex(budget, period.id)).reverse().find((p) => line.plans?.[p.id]) : null;
  const hasEarlier = ownPlan && budget.periods.slice(0, periodIndex(budget, period.id)).some((p) => line.plans?.[p.id]);
  const entries = lineEntries(budget, id).filter((e) => e.date >= period.start && e.date <= period.end);

  const changeMode = async (mode) => {
    if (mode === line.mode) return;
    const ok = await ui.confirm({ title: `Switch to ${MODES[mode].label}?`, message: 'Plans for this line start fresh; payments already recorded are kept.', okLabel: 'Switch' });
    if (!ok) return;
    actions.updateLine(id, { mode });
    actions.updatePlan(id, period.id, {});
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) openLine(null); }}>
      <div className="drawer b-line-editor">
        <div className="drawer-head">
          <span className="dot big" style={{ background: income ? 'var(--green)' : 'var(--amber)' }} />
          <TextInput className="title-input" value={line.name} onCommit={(v) => v.trim() && actions.updateLine(id, { name: v.trim() })} />
          <button className="icon-btn" onClick={() => openLine(null)} title="Close (Esc)">×</button>
        </div>
        <div className="drawer-body">
          {st ? (
            <div className="b-stats compact">
              <div className="b-stat"><div className="b-stat-label">Total</div><div className="b-stat-value">{fmtMoney(st.total)}</div></div>
              <div className="b-stat"><div className="b-stat-label">So far</div><div className="b-stat-value">{fmtMoney(st.actual)}</div></div>
              <div className="b-stat"><div className="b-stat-label">Remaining</div><div className="b-stat-value">{fmtMoney(st.predicted)}</div></div>
            </div>
          ) : <div className="muted small">Not shown in {period.name} (outside its dates).</div>}

          <div className="form-grid">
            <label>Type</label>
            <div className="segmented">
              <button className={cx(!income && 'active')} onClick={() => actions.updateLine(id, { kind: 'expense' })}>Expense</button>
              <button className={cx(income && 'active')} onClick={() => { actions.updateLine(id, { kind: 'income', mode: 'scheduled', groupId: null }); }}>Income</button>
            </div>
            {!income && <label>Works like</label>}
            {!income && (
              <div>
                <div className="segmented">
                  {Object.entries(MODES).map(([m, info]) => <button key={m} className={cx(line.mode === m && 'active')} onClick={() => changeMode(m)}>{info.label}</button>)}
                </div>
                <div className="muted small b-hint">{MODES[line.mode].hint}</div>
              </div>
            )}
            {!income && <label>Group</label>}
            {!income && (
              <select value={budget.groups[line.groupId] ? line.groupId : ''} onChange={async (e) => {
                if (e.target.value === '__new') { const n = await ui.prompt({ title: 'New group' }); if (n) actions.updateLine(id, { groupId: actions.addGroup(n) }); return; }
                actions.updateLine(id, { groupId: e.target.value || null });
              }}>
                <option value="">No group</option>
                {sortedGroups(budget).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value="__new">New group…</option>
              </select>
            )}
          </div>

          {st && (
            <div className="b-plan-box">
              <div className="b-plan-box-head">
                <span className="section-label">Plan for {period.name}</span>
                <span className="spacer" />
                <span className="muted small">{ownPlan ? (hasEarlier ? 'changed this month' : 'carries forward') : inheritsFrom ? `same as ${inheritsFrom.name}` : ''}</span>
                {ownPlan && hasEarlier && <button className="btn small ghost" onClick={() => actions.updateLine(id, { plans: Object.fromEntries(Object.entries(line.plans).filter(([k]) => k !== period.id)) })}>Use previous month's</button>}
              </div>
              {line.mode === 'repeat' && <RepeatPlan line={line} plan={st.plan} set={set} st={st} />}
              {line.mode === 'scheduled' && <ScheduledPlan line={line} plan={st.plan} set={set} st={st} />}
              {line.mode === 'allowance' && <AllowancePlan line={line} plan={st.plan} set={set} st={st} />}
            </div>
          )}

          <div>
            <div className="section-label">Active</div>
            <div className="row">
              <span className="muted small">from</span>
              <input type="date" value={line.from || ''} onChange={(e) => actions.updateLine(id, { from: e.target.value || null })} />
              <span className="muted small">until</span>
              <input type="date" value={line.to || ''} onChange={(e) => actions.updateLine(id, { to: e.target.value || null })} />
              {line.to ? <button className="btn small ghost" onClick={() => actions.updateLine(id, { to: null })}>No end</button>
                : <button className="btn small ghost" onClick={() => actions.updateLine(id, { to: period.end })}>Stop after {period.name}</button>}
            </div>
          </div>

          <div>
            <div className="section-label">{income ? 'Received' : 'Spent'} in {period.name}</div>
            {!entries.length && <div className="muted small">Nothing yet. Click a day in the grid to add one.</div>}
            {entries.map((e) => (
              <div key={e.id} className="b-entry-row">
                <input type="date" value={e.date} onChange={(ev) => ev.target.value && actions.updateEntry(e.id, { date: ev.target.value })} />
                <MoneyInput value={e.amount} onCommit={(v) => actions.updateEntry(e.id, { amount: v })} />
                <TextInput value={e.note} placeholder="Note" onCommit={(v) => actions.updateEntry(e.id, { note: v })} />
                {!income && <button className="icon-btn" title="Items" onClick={() => setBasket(e.id)}>{e.items?.length ? <span className="items-badge">{e.items.length}</span> : '☰'}</button>}
                <button className="icon-btn danger-text" onClick={() => withUndo(`Deleted ${fmtMoney(e.amount)}`, () => actions.deleteEntry(e.id))}>×</button>
              </div>
            ))}
          </div>

          <div className="row">
            <span className="spacer" />
            <button className="btn small ghost danger-text" onClick={async () => {
              const ok = await ui.confirm({ title: `Delete “${line.name}”?`, message: 'It disappears from every month, along with its recorded payments. To keep history, set an end date instead.', okLabel: 'Delete', danger: true });
              if (ok) { withUndo(`Deleted ${line.name}`, () => actions.deleteLine(id)); openLine(null); }
            }}>Delete line</button>
          </div>
        </div>
      </div>
      {basket && (
        <Basket
          lineId={id}
          initial={budget.entries[basket]?.items || []}
          onClose={() => setBasket(null)}
          onSave={(items, total) => actions.updateEntry(basket, { items, amount: total })}
        />
      )}
    </div>
  );
}
