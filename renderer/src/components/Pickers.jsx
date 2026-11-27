// Date, date-time and duration pickers shown as dialogs (used from right-click menus).
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { todayStr, addDays, startOfWeek, parseDay, dayStr, MONTH_NAMES, fmtDay, fmtMinutes, cx } from '../util';

const QUICK_TIMES = ['08:00', '09:00', '10:00', '12:00', '14:00', '16:00', '17:00', '19:00'];

function nextWeekday(target) {
  // Next occurrence of weekday `target` (0=Sun), never today.
  const d = parseDay(todayStr());
  const diff = ((target - d.getDay() + 7) % 7) || 7;
  return addDays(todayStr(), diff);
}

function useEscape(onCancel) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onCancel]);
}

export function DatePicker({ title, value = '', withTime = false, onDone, onCancel }) {
  const today = todayStr();
  const [date, setDate] = useState(value ? value.slice(0, 10) : '');
  const [time, setTime] = useState(withTime && value ? value.slice(11, 16) : '09:00');
  const [month, setMonth] = useState(() => {
    const d = parseDay(value ? value.slice(0, 10) : today);
    return dayStr(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  useEscape(onCancel);

  const m = parseDay(month);
  const gridStart = startOfWeek(month);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const shiftMonth = (n) => setMonth(dayStr(new Date(m.getFullYear(), m.getMonth() + n, 1)));
  const result = (d, t = time) => (withTime ? `${d}T${t}` : d);

  const pick = (d) => {
    setDate(d);
    const pd = parseDay(d);
    if (pd.getMonth() !== m.getMonth()) setMonth(dayStr(new Date(pd.getFullYear(), pd.getMonth(), 1)));
    if (!withTime) onDone(d); // date-only: one click is enough
  };

  const quick = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['Next Monday', nextWeekday(1)],
    ['In a week', addDays(today, 7)],
  ];

  return (
    <form className="modal picker" onSubmit={(e) => { e.preventDefault(); if (date) onDone(result(date)); }}>
      <h3>{title}</h3>
      <div className="picker-quick">
        {quick.map(([label, d]) => (
          <button key={label} type="button" className={cx('btn small', date === d && 'active')} onClick={() => pick(d)}>{label}</button>
        ))}
      </div>
      <div className="picker-month">
        <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)}><Icon name="chevronLeft" /></button>
        <span>{MONTH_NAMES[m.getMonth()]} {m.getFullYear()}</span>
        <button type="button" className="icon-btn" onClick={() => shiftMonth(1)}><Icon name="chevronRight" /></button>
      </div>
      <div className="picker-grid">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div key={d} className="picker-dow">{d}</div>)}
        {cells.map((d) => (
          <button
            key={d}
            type="button"
            className={cx('picker-day', parseDay(d).getMonth() !== m.getMonth() && 'out', d === today && 'today', d === date && 'selected')}
            onClick={() => pick(d)}
            onDoubleClick={() => onDone(result(d))}
          >
            {parseDay(d).getDate()}
          </button>
        ))}
      </div>
      {withTime && (
        <div className="picker-time">
          <div className="row">
            <Icon name="clock" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} step="300" />
            <span className="muted small">{date ? `${fmtDay(date)} at ${time}` : 'Pick a day'}</span>
          </div>
          <div className="picker-quick">
            {QUICK_TIMES.map((t) => (
              <button key={t} type="button" className={cx('btn small', time === t && 'active')} onClick={() => setTime(t)}>{t}</button>
            ))}
          </div>
        </div>
      )}
      <div className="modal-actions">
        {value && <button type="button" className="btn ghost danger-text" onClick={() => onDone('')}>Clear</button>}
        <div className="spacer" />
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        {withTime && <button type="submit" className="btn primary" disabled={!date}>Set</button>}
      </div>
    </form>
  );
}

// Accepts "90", "45m", "1h", "1.5h", "1h30", "1h 30m", "1:30". Returns minutes or null.
export function parseDuration(text) {
  const s = text.trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d+)$/))) return Number(m[1]);
  if ((m = s.match(/^(\d+)\s*m(in(ute)?s?)?$/))) return Number(m[1]);
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(ours?|rs?)?\s*(?:(\d+)\s*m?(in(ute)?s?)?)?$/))) return Math.round(Number(m[1]) * 60 + Number(m[3] || 0));
  return null;
}

const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480];

export function DurationPicker({ title = 'Estimate', value, onDone, onCancel }) {
  const [text, setText] = useState(value ? fmtMinutes(value) : '');
  const parsed = parseDuration(text);
  const inputRef = useRef(null);
  useEscape(onCancel);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  return (
    <form className="modal picker" onSubmit={(e) => { e.preventDefault(); if (parsed) onDone(parsed); }}>
      <h3>{title}</h3>
      <div className="picker-quick wrap">
        {DURATIONS.map((d) => (
          <button key={d} type="button" className={cx('btn small', value === d && 'active')} onClick={() => onDone(d)}>{fmtMinutes(d)}</button>
        ))}
      </div>
      <label className="field">
        <span>Custom duration</span>
        <input ref={inputRef} value={text} placeholder="e.g. 90, 45m, 1h30, 2.5h" onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="muted small picker-preview">
        {text ? (parsed ? `= ${fmtMinutes(parsed)}` : "Couldn't read that — try 90, 45m, 1h30 or 2.5h") : ' '}
      </div>
      <div className="modal-actions">
        {value ? <button type="button" className="btn ghost danger-text" onClick={() => onDone(0)}>Clear</button> : null}
        <div className="spacer" />
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!parsed}>Set</button>
      </div>
    </form>
  );
}
