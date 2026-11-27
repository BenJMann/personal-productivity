import { useEffect, useRef, useState } from 'react';
import { useBudget } from './BudgetApp';
import { useUI } from '../ui';
import { fmtMoney, fmtShort, periodRange, periodIndex, sortedGroups, MODES, nextMonthStart, endOfMonth, defaultPeriodName, round2 } from './model';
import { MoneyInput, Modal, Check } from './inputs';
import CellPopover from './CellPopover';
import { addDays, parseDay, DAY_NAMES, MONTH_NAMES, colorFor, cx, fmtDay } from '../util';

const MODE_ICON = { repeat: '↻', scheduled: '◷', allowance: '◔' };

// ---------- adding things ----------

function OneOffDialog({ onClose, kind = 'expense' }) {
  const { budget, actions, period, today, withUndo, openLine } = useBudget();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(null);
  const [date, setDate] = useState(today >= period.start && today <= period.end ? today : period.start);
  const [paid, setPaid] = useState(true);
  const [groupId, setGroupId] = useState('');
  const income = kind === 'income';
  const save = () => {
    if (!name.trim() || amount == null) return;
    withUndo(`Added ${name.trim()}`, () => {
      const id = actions.addLine({ periodId: period.id, name: name.trim(), kind, mode: 'scheduled', groupId: groupId || null, from: date, to: date });
      if (paid) actions.addEntry({ lineId: id, date, amount });
      else actions.addItem(id, { date, amount, amountEst: false, dateEst: false });
    });
    onClose();
  };
  return (
    <Modal
      title={income ? 'One-off income' : 'One-off expense'}
      onClose={onClose}
      actions={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={!name.trim() || amount == null}>Add</button></>}
    >
      <p className="muted">Gets its own column for this month only. {income ? '' : 'Adjust other lines afterwards to make the month fit.'}</p>
      <div className="form-grid">
        <label>Name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={income ? 'e.g. Sold old phone' : 'e.g. Night out'} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <label>Amount</label>
        <MoneyInput value={amount} onCommit={setAmount} onEnter={(v) => { if (v != null) setAmount(v); }} allowEmpty />
        <label>Date</label>
        <input type="date" value={date} min={period.start} max={period.end} onChange={(e) => e.target.value && setDate(e.target.value)} />
        {!income && <label>Group</label>}
        {!income && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">No group</option>
            {sortedGroups(budget).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        <span />
        <Check checked={paid} onChange={setPaid}>{income ? 'Already received' : 'Already spent'}</Check>
      </div>
    </Modal>
  );
}

function StartMonthDialog({ onClose }) {
  const { budget, actions, today, setPeriodId, withUndo } = useBudget();
  const cur = budget.periods[budget.periods.length - 1];
  const min = addDays(cur.start, 1);
  const [date, setDate] = useState(today > cur.start && today <= cur.end ? today : min);
  const [name, setName] = useState(defaultPeriodName(date));
  const [nameTouched, setNameTouched] = useState(false);
  const [opening, setOpening] = useState(null);
  const valid = date > cur.start && date <= cur.end;
  const end = endOfMonth(nextMonthStart(date));
  const save = () => {
    if (!valid) return;
    withUndo(`Started ${name}`, () => {
      const id = actions.startNewMonth(date, { opening, name });
      if (id) setPeriodId(id);
    });
    onClose();
  };
  return (
    <Modal
      title="Start a new month"
      onClose={onClose}
      actions={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={!valid}>Start {name}</button></>}
    >
      <div className="form-grid">
        <label>Starts on</label>
        <input type="date" value={date} min={min} max={cur.end} onChange={(e) => { const d = e.target.value; if (!d) return; setDate(d); if (!nameTouched) setName(defaultPeriodName(d)); }} />
        <label>Name</label>
        <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} />
        <label>Starting balance</label>
        <MoneyInput value={opening} onCommit={setOpening} allowEmpty placeholder="carry over" />
      </div>
      {valid ? (
        <p className="muted small b-explain">
          <strong>{cur.name}</strong> will end on {fmtDay(addDays(date, -1))}. <strong>{name}</strong> runs {fmtShort(date)} – {fmtShort(end)} and becomes the current month{date > today ? ` on ${fmtShort(date)}` : ''}.
          {name.trim() === cur.name && <> It has the same name as the month before — click a month's name to rename it any time.</>}
          Plans carry over; anything already spent from {fmtShort(date)} moves with it. {opening == null ? 'The starting balance carries over from the projection.' : ''} You can undo this.
        </p>
      ) : <p className="danger-text small">Pick a day after {fmtShort(cur.start)} and on or before {fmtShort(cur.end)}.</p>}
    </Modal>
  );
}

export function useAddMenu() {
  const { budget, actions, period, openLine } = useBudget();
  const ui = useUI();
  const [dialog, setDialog] = useState(null);
  const create = async (mode, kind = 'expense', groupId = null) => {
    const label = kind === 'income' ? 'New income' : `New ${MODES[mode].label.toLowerCase()}`;
    const name = await ui.prompt({ title: label, placeholder: 'Name', message: kind === 'income' ? 'Wages, benefits, anything coming in. Set the expected day and amount next.' : MODES[mode].hint });
    if (!name) return;
    openLine(actions.addLine({ periodId: period.id, name, kind, mode, groupId, from: period.start }));
  };
  const items = (groupId = null) => [
    { header: 'Expense' },
    { label: 'Recurring purchase…', hint: 'every N days', onClick: () => create('repeat', 'expense', groupId) },
    { label: 'Scheduled / bill…', hint: 'on dates', onClick: () => create('scheduled', 'expense', groupId) },
    { label: 'Allowance…', hint: '£ per week', onClick: () => create('allowance', 'expense', groupId) },
    { label: 'One-off expense…', onClick: () => setDialog('oneoff') },
    { separator: true },
    { header: 'Income' },
    { label: 'Income…', onClick: () => create('scheduled', 'income') },
    { label: 'One-off income…', onClick: () => setDialog('oneoff-income') },
    { separator: true },
    !groupId && {
      label: 'New group…',
      onClick: async () => {
        const name = await ui.prompt({ title: 'New group', placeholder: 'e.g. Bills', message: 'Groups gather lines together, like the blocks in your spreadsheet.' });
        if (name) actions.addGroup(name);
      },
    },
  ];
  const node = dialog === 'oneoff' ? <OneOffDialog onClose={() => setDialog(null)} />
    : dialog === 'oneoff-income' ? <OneOffDialog kind="income" onClose={() => setDialog(null)} />
    : dialog === 'month' ? <StartMonthDialog onClose={() => setDialog(null)} /> : null;
  return { items, node, setDialog, budget };
}

// ---------- header & summary ----------

function PeriodHeader({ add }) {
  const { budget, actions, period, current, setPeriodId, result, withUndo } = useBudget();
  const ui = useUI();
  const idx = periodIndex(budget, period.id);
  const latest = idx === budget.periods.length - 1;
  const go = (d) => { const p = budget.periods[idx + d]; if (p) setPeriodId(p.id === current.id ? null : p.id); };

  useEffect(() => {
    const key = (e) => {
      if (e.target.closest('input, select, textarea') || document.querySelector('.modal-backdrop, .b-float, .drawer')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className="view-head b-head">
      <button className="icon-btn" disabled={idx <= 0} onClick={() => go(-1)} title="Previous month (←)">‹</button>
      <h1 className="clickable" title="Rename" onClick={async () => {
        const name = await ui.prompt({ title: 'Rename month', value: period.name });
        if (name) actions.updatePeriod(period.id, { name });
      }}>{period.name}</h1>
      <button className="icon-btn" disabled={latest} onClick={() => go(1)} title="Next month (→)">›</button>
      <span className="muted">{periodRange(period)}</span>
      {result.status === 'current' ? <span className="chip b-chip-current">Current</span> : <button className="btn small ghost" onClick={() => setPeriodId(null)}>Back to current</button>}
      <span className="spacer" />
      {latest && period.splitFrom && (
        <button className="btn small ghost" title="Merge this month back into the previous one" onClick={async () => {
          const ok = await ui.confirm({ title: `Undo starting ${period.name}?`, message: `${budget.periods[idx - 1].name} will run until ${fmtShort(period.splitFrom)} again. Spending stays where it is; plan changes made only for ${period.name} are dropped.`, okLabel: 'Undo new month' });
          if (ok) withUndo('New month undone', () => { actions.undoNewMonth(); setPeriodId(null); });
        }}>↶ Undo new month</button>
      )}
      {latest && <button className="btn small" onClick={() => add.setDialog('month')}>Start a new month…</button>}
      <button className="btn small primary" onClick={(e) => ui.openMenu(e, add.items())}>+ Add</button>
    </div>
  );
}

function Stat({ label, value, sub, tone, onClick, title }) {
  return (
    <div className={cx('b-stat', onClick && 'clickable', tone)} onClick={onClick} title={title}>
      <div className="b-stat-label">{label}</div>
      <div className="b-stat-value">{value}</div>
      {sub && <div className="b-stat-sub">{sub}</div>}
    </div>
  );
}

function SummaryStrip() {
  const { actions, period, result, today } = useBudget();
  const ui = useUI();
  const t = result.totals;
  const editOpening = async () => {
    const v = await ui.prompt({ title: 'Starting balance', label: `Money in the account at the start of ${period.name} (leave empty to carry over from the previous month)`, value: period.opening == null ? '' : String(period.opening) });
    if (v === null) return;
    const n = Number(String(v).replace(/[£,]/g, ''));
    actions.updatePeriod(period.id, { opening: v.trim() === '' || !Number.isFinite(n) ? null : n });
  };
  return (
    <div className="b-stats">
      <Stat label="Start" value={fmtMoney(result.opening)} sub={result.openingCarried ? 'carried over · edit' : 'set · edit'} onClick={editOpening} title="Starting balance for this month" />
      <Stat label="Money in" value={fmtMoney(t.inTotal)} sub={`${fmtMoney(t.inActual)} received`} tone="in" />
      <Stat label="Total spend" value={fmtMoney(t.outTotal)} sub={`${fmtMoney(t.outActual)} so far`} />
      <Stat label="Still to spend" value={fmtMoney(t.outPredicted)} />
      {result.status === 'current' && <Stat label="Today" value={fmtMoney(result.balanceToday)} tone={result.balanceToday < 0 ? 'bad' : ''} sub="expected balance" />}
      <Stat label={result.status === 'past' ? 'Ended with' : 'Unallocated'} value={fmtMoney(result.closing)} tone={result.closing < 0 ? 'bad' : 'good'} sub={`at ${fmtShort(period.end)}`} />
      {result.low && result.low.balance < 0 && (
        <div className="b-warn">⚠ Goes to <strong>{fmtMoney(result.low.balance)}</strong> on {result.low.date === today ? 'today' : fmtDay(result.low.date)}</div>
      )}
    </div>
  );
}

// The spreadsheet's "income, then each block and what's left after it" view.
function PlanPanel({ onClose }) {
  const { result, openLine } = useBudget();
  const [open, setOpen] = useState({});
  let left = result.opening + result.totals.inTotal;
  const outSections = result.sections.filter((s) => !s.income);
  return (
    <aside className="b-plan">
      <div className="b-plan-head"><strong>Plan</strong><span className="spacer" /><button className="icon-btn" onClick={onClose} title="Hide">×</button></div>
      <div className="b-plan-row"><span>Start</span><span>{fmtMoney(result.opening)}</span></div>
      {result.sections.filter((s) => s.income).flatMap((s) => s.lines).map((l) => (
        <div key={l.id} className="b-plan-row in clickable" onClick={() => openLine(l.id)}><span>+ {l.name}</span><span>{fmtMoney(result.stats[l.id].total)}</span></div>
      ))}
      <div className="b-plan-row strong"><span>Available</span><span>{fmtMoney(left)}</span></div>
      {outSections.map((s) => {
        const total = round2(s.lines.reduce((a, l) => a + result.stats[l.id].total, 0));
        left = round2(left - total);
        return (
          <div key={s.id} className="b-plan-group">
            <div className="b-plan-row clickable" onClick={() => setOpen({ ...open, [s.id]: !open[s.id] })}>
              <span><span className="b-caret">{open[s.id] ? '▾' : '▸'}</span>{s.name || 'Spending'}</span><span>−{fmtMoney(total)}</span>
            </div>
            {open[s.id] && s.lines.map((l) => (
              <div key={l.id} className="b-plan-row sub clickable" onClick={() => openLine(l.id)}><span>{l.name}</span><span>{fmtMoney(result.stats[l.id].total)}</span></div>
            ))}
            <div className={cx('b-plan-row left', left < 0 && 'bad')}><span>left</span><span>{fmtMoney(left)}</span></div>
          </div>
        );
      })}
      <div className={cx('b-plan-row strong', result.closing < 0 ? 'bad' : 'good')}><span>Unallocated</span><span>{fmtMoney(result.closing)}</span></div>
    </aside>
  );
}

// ---------- grid ----------

function cellView(line, c, today, date) {
  if (!c) return { cls: 'empty', text: '' };
  if (c.entries.length) {
    const items = c.entries.some((e) => e.items?.length);
    return { cls: cx('actual', items && 'itemised'), text: (line.mode === 'repeat' ? '✓ ' : '') + fmtMoney(c.actual) };
  }
  if (c.preds.length) {
    const est = c.preds.some((p) => p.amountEst) && line.mode !== 'repeat';
    const overdue = c.preds.some((p) => p.overdue);
    if (line.mode === 'allowance') return { cls: 'soft', text: fmtMoney(c.predicted) };
    if (line.mode === 'repeat') return { cls: cx('pred repeat', overdue && 'overdue'), text: fmtMoney(c.predicted), box: true };
    const dateEst = c.preds.some((p) => p.dateEst);
    return { cls: cx('pred', overdue && 'overdue', dateEst && 'date-est'), text: fmtMoney(c.predicted, { est }) };
  }
  if (c.missed.length) return { cls: 'missed', text: fmtMoney(c.missed.reduce((s, p) => s + p.amount, 0)) };
  return { cls: 'empty', text: '' };
}

function cellTitle(line, c, date) {
  const bits = [`${line.name} · ${fmtDay(date)}`];
  if (!c) return bits.concat('Click to add').join('\n');
  for (const e of c.entries) bits.push(`${fmtMoney(e.amount)}${e.note ? ` — ${e.note}` : ''}${e.items?.length ? ` (${e.items.map((x) => `${x.qty > 1 ? x.qty + '× ' : ''}${x.name}`).join(', ')})` : ''}`);
  for (const p of c.preds) {
    if (line.mode === 'allowance') { bits.push(`About ${fmtMoney(p.amount)}/day left in the allowance`); break; }
    bits.push(`Expected ${fmtMoney(p.amount, { est: p.amountEst })}${p.dateEst ? ' (date estimated)' : ''}${p.overdue ? ` — due ${fmtShort(p.overdue)}` : ''}`);
  }
  for (const p of c.missed) bits.push(`Missed: ${fmtMoney(p.amount)} was expected`);
  if (line.mode === 'repeat' && !c.entries.length) bits.push('Click to record a purchase');
  return bits.join('\n');
}

function lineMenu(line, sectionLines, { actions, budget, period, openLine, withUndo, ui }) {
  const ids = sectionLines.map((l) => l.id);
  const i = ids.indexOf(line.id);
  return [
    { label: 'Edit…', icon: 'edit', onClick: () => openLine(line.id) },
    { label: 'Move left', disabled: i <= 0, onClick: () => actions.moveLine(line.id, -1, ids) },
    { label: 'Move right', disabled: i >= ids.length - 1, onClick: () => actions.moveLine(line.id, 1, ids) },
    line.kind !== 'income' && {
      label: 'Move to group',
      icon: 'folder',
      submenu: [
        ...sortedGroups(budget).map((g) => ({ label: g.name, checked: line.groupId === g.id, onClick: () => actions.updateLine(line.id, { groupId: g.id }) })),
        { label: 'No group', checked: !budget.groups[line.groupId], onClick: () => actions.updateLine(line.id, { groupId: null }) },
        { separator: true },
        { label: 'New group…', onClick: async () => { const n = await ui.prompt({ title: 'New group' }); if (n) actions.updateLine(line.id, { groupId: actions.addGroup(n) }); } },
      ],
    },
    { separator: true },
    { label: 'Stop after this month', onClick: () => withUndo(`${line.name} stops after ${period.name}`, () => actions.updateLine(line.id, { to: period.end })) },
    line.to && { label: 'Keep going (no end)', onClick: () => actions.updateLine(line.id, { to: null }) },
    { separator: true },
    { label: 'Delete line…', icon: 'trash', danger: true, onClick: async () => {
      const n = Object.values(budget.entries).filter((e) => e.lineId === line.id).length;
      const ok = await ui.confirm({ title: `Delete “${line.name}”?`, message: n ? `Its ${n} recorded payment${n > 1 ? 's' : ''} will be deleted too, in every month. To keep history, use “Stop after this month” instead.` : 'It will disappear from every month.', okLabel: 'Delete', danger: true });
      if (ok) withUndo(`Deleted ${line.name}`, () => actions.deleteLine(line.id));
    } },
  ];
}

function groupMenu(section, ctx, add) {
  const { actions, withUndo, ui } = ctx;
  const g = section.group;
  if (!g) return add.items();
  return [
    { label: 'Rename group…', icon: 'edit', onClick: async () => { const n = await ui.prompt({ title: 'Rename group', value: g.name }); if (n) actions.updateGroup(g.id, { name: n }); } },
    { label: 'Move group left', onClick: () => actions.moveGroup(g.id, -1) },
    { label: 'Move group right', onClick: () => actions.moveGroup(g.id, 1) },
    { separator: true },
    { header: `Add to ${g.name}` },
    ...add.items(g.id).filter((x) => x && (x.onClick || x.separator) && !/income|One-off/i.test(x.label || '')).filter((x) => !x.separator),
    { separator: true },
    { label: 'Delete group', icon: 'trash', danger: true, onClick: () => withUndo(`Deleted group ${g.name}`, () => actions.deleteGroup(g.id)) },
  ];
}

function Grid({ add }) {
  const ctx = useBudget();
  const { result, today, actions, withUndo, openLine } = ctx;
  const ui = useUI();
  const [pop, setPop] = useState(null);
  const wrapRef = useRef(null);
  const todayRef = useRef(null);
  const { sections, lines, days, cells, stats, daily, period } = result;
  const hasIncome = lines.some((l) => l.kind === 'income');

  useEffect(() => {
    const row = todayRef.current;
    const wrap = wrapRef.current;
    if (row && wrap) wrap.scrollTop = Math.max(0, row.offsetTop - wrap.clientHeight / 2);
  }, [period.id]);

  if (!lines.length) {
    return (
      <div className="empty b-empty">
        <div className="empty-icon">£</div>
        <p>Nothing planned for {period.name} yet.</p>
        <p className="muted small">Add your income, then the things you spend on. Each becomes a column, like your spreadsheet.</p>
        <button className="btn primary" onClick={(e) => ui.openMenu(e, add.items())}>+ Add your first line</button>
      </div>
    );
  }

  const onCell = (line, date, c, e) => {
    if (line.mode === 'repeat' && !c?.entries.length && date <= today) {
      const unit = stats[line.id].unit;
      if (unit > 0) {
        withUndo(`Bought ${line.name} · ${fmtMoney(unit)}`, () => actions.addEntry({ lineId: line.id, date, amount: unit }));
        return;
      }
    }
    setPop({ lineId: line.id, date, rect: e.currentTarget.getBoundingClientRect() });
  };

  const dayLabel = (d) => {
    const dt = parseDay(d);
    return <><span className="b-dow">{DAY_NAMES[dt.getDay()]}</span> {dt.getDate()}{(dt.getDate() === 1 || d === period.start) && <span className="b-mon"> {MONTH_NAMES[dt.getMonth()].slice(0, 3)}</span>}</>;
  };

  return (
    <div className="b-grid-wrap" ref={wrapRef}>
      <table className="b-grid">
        <thead>
          <tr className="b-sec-row">
            <th className="b-date-col" />
            {sections.map((s) => (
              <th key={s.id} colSpan={s.lines.length} className={cx('b-sec', s.income && 'income')} style={s.group ? { '--sec': colorFor(s.group.id) } : undefined}
                onContextMenu={(e) => ui.openMenu(e, groupMenu(s, { ...ctx, ui }, add))}>
                {s.name}
              </th>
            ))}
            <th className="b-sum-col" colSpan={hasIncome ? 3 : 2} />
          </tr>
          <tr className="b-name-row">
            <th className="b-date-col" />
            {sections.flatMap((s) => s.lines.map((l) => (
              <th key={l.id} className={cx('b-line-head', l.kind === 'income' && 'income')} onClick={() => openLine(l.id)}
                onContextMenu={(e) => ui.openMenu(e, lineMenu(l, s.lines, { ...ctx, ui }))} title={`${MODES[l.mode].label}${stats[l.id].overdue ? ' — something is overdue' : ''}\nClick to edit, right-click for more`}>
                <span className="b-line-name">{l.name}</span>
                <span className="b-mode">{MODE_ICON[l.mode]}{stats[l.id].overdue > 0 && <span className="b-due">!</span>}</span>
              </th>
            )))}
            {hasIncome && <th className="b-sum-col">In</th>}
            <th className="b-sum-col">Out</th>
            <th className="b-sum-col">Balance</th>
          </tr>
          {[
            ['Total', 'total', result.totals.inTotal, result.totals.outTotal],
            ['So far', 'actual', result.totals.inActual, result.totals.outActual],
            ['Remaining', 'predicted', result.totals.inPredicted, result.totals.outPredicted],
          ].map(([label, f, tin, tout]) => (
            <tr key={f} className={cx('b-tot-row', f)}>
              <th className="b-date-col">{label}</th>
              {lines.map((l) => {
                const st = stats[l.id];
                let extra = null;
                if (f === 'total' && l.mode === 'allowance' && st.budget != null && Math.abs(st.total - st.budget) > 0.5) extra = <span className={st.total > st.budget ? 'danger-text' : 'ok-text'} title={`Allowance ${fmtMoney(st.budget)}`}> /{fmtMoney(st.budget)}</span>;
                if (f === 'actual' && l.mode === 'allowance' && st.pace != null && result.status === 'current') {
                  const diff = round2(st.actual - st.pace);
                  if (Math.abs(diff) >= 1) extra = <span className={diff > 0 ? 'danger-text' : 'ok-text'} title={`By today you'd expect to have spent ${fmtMoney(st.pace)}`}> {diff > 0 ? '▲' : '▼'}</span>;
                }
                return <td key={l.id} className={cx(l.kind === 'income' && 'income')} onClick={() => openLine(l.id)}>{fmtMoney(st[f])}{extra}</td>;
              })}
              {hasIncome && <td className="b-sum-col income">{fmtMoney(tin)}</td>}
              <td className="b-sum-col">{fmtMoney(tout)}</td>
              <td className="b-sum-col">{f === 'total' ? <span className={result.closing < 0 ? 'danger-text' : ''} title="End-of-month balance">{fmtMoney(result.closing)}</span> : ''}</td>
            </tr>
          ))}
        </thead>
        <tbody>
          {days.map((d, i) => {
            const dt = parseDay(d);
            const day = daily[i];
            const wkend = dt.getDay() === 0 || dt.getDay() === 6;
            return (
              <tr key={d} ref={d === today ? todayRef : undefined} className={cx(d === today && 'today', d < today && 'past', wkend && 'wkend', dt.getDate() === 1 && d !== period.start && 'month-start')}>
                <th className="b-date-col">{dayLabel(d)}</th>
                {lines.map((l) => {
                  const c = cells[`${l.id}|${d}`];
                  const v = cellView(l, c, today, d);
                  return (
                    <td key={l.id} className={cx('b-cell', v.cls, l.kind === 'income' && 'income', pop && pop.lineId === l.id && pop.date === d && 'selected')} title={cellTitle(l, c, d)} onClick={(e) => onCell(l, d, c, e)}>
                      {v.box && <span className="b-box" />}{v.text}
                    </td>
                  );
                })}
                {hasIncome && <td className="b-sum-col income">{day.aIn + day.pIn ? fmtMoney(day.aIn + day.pIn) : ''}</td>}
                <td className="b-sum-col">{day.aOut + day.pOut >= 0.005 ? fmtMoney(day.aOut + day.pOut) : ''}</td>
                <td className={cx('b-sum-col b-bal', day.balance < 0 && 'neg', d >= today && 'proj')}>{fmtMoney(day.balance)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pop && <CellPopover key={pop.lineId + pop.date} {...pop} onClose={() => setPop(null)} />}
    </div>
  );
}

export default function MonthView() {
  const ctx = useBudget();
  const add = useAddMenu();
  const [showPlan, setShowPlan] = useState(() => { try { return localStorage.getItem('pp-budget-plan') !== '0'; } catch { return true; } });
  const togglePlan = (v) => { setShowPlan(v); try { localStorage.setItem('pp-budget-plan', v ? '1' : '0'); } catch {} };
  if (!ctx.period || !ctx.result) return null;
  return (
    <div className="b-month">
      <PeriodHeader add={add} />
      <SummaryStrip />
      <div className="b-month-body">
        <Grid add={add} />
        {showPlan && ctx.result.lines.length > 0 ? <PlanPanel onClose={() => togglePlan(false)} /> : ctx.result.lines.length > 0 && (
          <button className="b-plan-tab" onClick={() => togglePlan(true)} title="Show plan">Plan ‹</button>
        )}
      </div>
      <div className="b-legend muted small">
        <span><b className="lg actual">£5</b> spent</span>
        <span><b className="lg pred">£5</b> expected</span>
        <span><b className="lg pred">~£5</b> estimated amount</span>
        <span><b className="lg pred date-est">£5</b> estimated date</span>
        <span><b className="lg"><span className="b-box" /></b> predicted purchase — click when bought</span>
        <span><b className="lg overdue pred">£5</b> overdue</span>
        <span>↻ recurring purchase · ◷ scheduled · ◔ allowance</span>
      </div>
      {add.node}
    </div>
  );
}

