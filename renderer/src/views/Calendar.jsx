import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, useNow } from '../store';
import { useUI } from '../ui';
import { taskMenu } from '../menus';
import TaskRow from '../components/TaskRow';
import { todayGroups } from './Today';
import { todayStr, addDays, startOfWeek, parseDay, dayStr, DAY_NAMES, FULL_DAY_NAMES, MONTH_NAMES, colorFor, fmtTime, cx } from '../util';
import { taskProjectId } from '../store';
import { exportRange, exportFilename, buildCalendarHtml } from '../exportPdf';

// Pixel height of one hour at each zoom step; 48 is the default (100%).
const ZOOM_LEVELS = [32, 48, 64, 96, 128, 192];
const DEFAULT_HOUR_H = 48;
const SNAP = 15;
const pad = (n) => String(n).padStart(2, '0');
const minutesOf = (dt) => Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
const toTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function loadPref(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function savePref(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

// Greedy lane assignment so overlapping events sit side by side.
function layoutEvents(events) {
  const sorted = [...events].sort((a, b) => a.top - b.top || b.height - a.height);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((e) => e.lane + 1));
    cluster.forEach((e) => out.push({ ...e, lanes }));
    cluster = [];
  };
  for (const ev of sorted) {
    if (ev.top >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.top + c.height > ev.top).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...ev, lane });
    clusterEnd = Math.max(clusterEnd, ev.top + ev.height);
  }
  if (cluster.length) flush();
  return out;
}

function useTaskDrop(onDrop) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e) => { if (e.dataTransfer.types.includes('application/x-task')) { e.preventDefault(); setOver(true); } },
      onDragLeave: () => setOver(false),
      onDrop: (e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('application/x-task');
        const grab = Number(e.dataTransfer.getData('application/x-grab') || 0);
        if (id) onDrop(id, e, grab);
      },
    },
  };
}

function EventBlock({ task, ev, hourH }) {
  const store = useStore();
  const ui = useUI();
  const [resizeH, setResizeH] = useState(null);
  const pid = taskProjectId(store.state, task);
  const color = colorFor(pid);
  const height = resizeH ?? ev.height;

  const startResize = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    let h = ev.height;
    const move = (m) => { h = Math.max((SNAP / 60) * hourH, ev.height + (m.clientY - startY)); setResizeH(h); };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const minutes = Math.max(SNAP, Math.round((h / hourH) * 60 / SNAP) * SNAP);
      store.actions.updateTask(task.id, { estimate: minutes });
      setResizeH(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Short events collapse to a single line so the title stays readable.
  const size = height < 22 ? 'xs' : height < 40 ? 'sm' : '';
  const startMin = minutesOf(task.start);
  const endMin = startMin + Math.max(SNAP, Math.round((height / hourH) * 60));
  const timeLabel = size ? fmtTime(task.start) : `${fmtTime(task.start)} – ${toTime(Math.min(endMin, 24 * 60) % (24 * 60))}`;

  return (
    <div
      className={cx('cal-event', size, task.completed && 'completed', store.state.alerts.includes(task.id) && 'is-alert')}
      style={{ top: ev.top, height, left: `calc(${(ev.lane / ev.lanes) * 100}% + 2px)`, width: `calc(${100 / ev.lanes}% - 4px)`, borderLeftColor: color, background: `color-mix(in srgb, ${color} 22%, var(--bg-2))` }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-task', task.id);
        e.dataTransfer.setData('application/x-grab', String(e.clientY - e.currentTarget.getBoundingClientRect().top));
      }}
      onClick={(e) => { e.stopPropagation(); ui.openTask(task.id); }}
      onContextMenu={(e) => ui.openMenu(e, taskMenu(task, store, ui))}
      title={`${task.title}\n${fmtTime(task.start)} – ${toTime(Math.min(endMin, 24 * 60) % (24 * 60))}`}
    >
      {size ? (
        <>
          <span className="ev-title">{task.title}</span>
          <span className="ev-time">{timeLabel}</span>
        </>
      ) : (
        <>
          <div className="ev-title">{task.title}</div>
          <div className="ev-time">{timeLabel}</div>
        </>
      )}
      <div className="ev-resize" onMouseDown={startResize} />
    </div>
  );
}

function AllDayChip({ task }) {
  const store = useStore();
  const ui = useUI();
  const color = colorFor(taskProjectId(store.state, task));
  return (
    <div
      className={cx('allday-chip', task.completed && 'completed')}
      style={{ borderLeftColor: color }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-task', task.id)}
      onClick={(e) => { e.stopPropagation(); ui.openTask(task.id); }}
      onContextMenu={(e) => ui.openMenu(e, taskMenu(task, store, ui))}
      title={task.title}
    >
      {task.start && <span className="muted">{fmtTime(task.start)} </span>}
      {task.title}
    </div>
  );
}

function DayColumn({ day, tasks, hourH }) {
  const { actions } = useStore();
  const ui = useUI();
  const now = useNow(60000);
  const ref = useRef(null);
  const drop = useTaskDrop((id, e, grab) => {
    const rect = ref.current.getBoundingClientRect();
    const y = e.clientY - rect.top - grab;
    const min = Math.min(24 * 60 - SNAP, Math.max(0, Math.round(((y / hourH) * 60) / SNAP) * SNAP));
    actions.updateTask(id, { start: `${day}T${toTime(min)}`, day });
  });

  const events = layoutEvents(
    tasks.map((t) => ({ id: t.id, top: (minutesOf(t.start) / 60) * hourH, height: Math.max(SNAP, t.estimate || 30) / 60 * hourH })),
  );
  const isToday = day === todayStr();
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();

  return (
    <div
      ref={ref}
      className={cx('day-col', drop.over && 'drop-over', isToday && 'today')}
      style={{ height: 24 * hourH }}
      {...drop.props}
      onDoubleClick={async (e) => {
        const rect = ref.current.getBoundingClientRect();
        const step = hourH >= 96 ? 15 : 30;
        const min = Math.floor(((e.clientY - rect.top) / hourH) * 60 / step) * step;
        const title = await ui.prompt({ title: `New task at ${toTime(min)}`, placeholder: 'Task title' });
        if (title) actions.addTask({ title, start: `${day}T${toTime(min)}`, day, estimate: 30 });
      }}
    >
      {Array.from({ length: 24 }, (_, h) => <div key={h} className="hour-line" style={{ top: h * hourH }} />)}
      {hourH >= 64 && Array.from({ length: 24 }, (_, h) => <div key={`h${h}`} className="hour-line half" style={{ top: (h + 0.5) * hourH }} />)}
      {isToday && <div className="now-line" style={{ top: (nowMin / 60) * hourH }} />}
      {events.map((ev) => {
        const t = tasks.find((x) => x.id === ev.id);
        return <EventBlock key={ev.id} task={t} ev={ev} hourH={hourH} />;
      })}
    </div>
  );
}

function AllDayCell({ day, tasks }) {
  const { actions } = useStore();
  const drop = useTaskDrop((id) => actions.updateTask(id, { day, start: '' }));
  return (
    <div className={cx('allday-cell', drop.over && 'drop-over')} {...drop.props}>
      {tasks.map((t) => <AllDayChip key={t.id} task={t} />)}
    </div>
  );
}

function TimeGrid({ days, hourH, setHourH }) {
  const { state } = useStore();
  const scrollRef = useRef(null);
  const anchorRef = useRef(null);
  const prevH = useRef(hourH);
  const today = todayStr();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * hourH;
  }, []);

  // Keep the time under the cursor (or the middle of the view) fixed while zooming.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || prevH.current === hourH) return;
    const offset = anchorRef.current ?? el.clientHeight / 2;
    const minute = ((el.scrollTop + offset) / prevH.current) * 60;
    el.scrollTop = (minute / 60) * hourH - offset;
    prevH.current = hourH;
    anchorRef.current = null;
  }, [hourH]);

  // Ctrl/Cmd + wheel zooms the time axis. Needs a non-passive listener to block page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      anchorRef.current = e.clientY - el.getBoundingClientRect().top;
      setHourH((h) => zoomStep(h, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setHourH]);

  const tasks = Object.values(state.tasks);
  const timed = (d) => tasks.filter((t) => t.start && t.start.slice(0, 10) === d);
  const allDay = (d) => tasks.filter((t) => !t.start && t.day === d);

  return (
    <div className="time-grid">
      <div className="tg-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((d) => {
          const dt = parseDay(d);
          return (
            <div key={d} className={cx('tg-day-head', d === today && 'today')}>
              <span className="muted">{DAY_NAMES[dt.getDay()]}</span> <span className="day-num">{dt.getDate()}</span>
            </div>
          );
        })}
        <div className="allday-label muted small">all day</div>
        {days.map((d) => <AllDayCell key={d} day={d} tasks={allDay(d)} />)}
      </div>
      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
          <div className="hour-labels" style={{ height: 24 * hourH }}>
            {Array.from({ length: 24 }, (_, h) => <div key={h} className="hour-label" style={{ top: h * hourH }}>{h ? `${pad(h)}:00` : ''}</div>)}
            {hourH >= 96 && Array.from({ length: 24 }, (_, h) => <div key={`h${h}`} className="hour-label half" style={{ top: (h + 0.5) * hourH }}>{`${pad(h)}:30`}</div>)}
          </div>
          {days.map((d) => <DayColumn key={d} day={d} tasks={timed(d)} hourH={hourH} />)}
        </div>
      </div>
    </div>
  );
}

function zoomStep(h, dir) {
  const i = ZOOM_LEVELS.findIndex((z) => z >= h);
  const cur = i < 0 ? ZOOM_LEVELS.length - 1 : i;
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, cur + dir))];
}

function MonthCell({ day, inMonth, tasks, onOpenDay }) {
  const { actions, state } = useStore();
  const drop = useTaskDrop((id) => {
    const t = state.tasks[id];
    actions.updateTask(id, { day, start: t.start ? `${day}${t.start.slice(10)}` : '' });
  });
  const sorted = [...tasks].sort((a, b) => (a.start || '~').localeCompare(b.start || '~'));
  return (
    <div className={cx('month-cell', !inMonth && 'out', day === todayStr() && 'today', drop.over && 'drop-over')} {...drop.props}>
      <div className="month-day" onClick={() => onOpenDay(day)}>{parseDay(day).getDate()}</div>
      {sorted.slice(0, 4).map((t) => <AllDayChip key={t.id} task={t} />)}
      {sorted.length > 4 && <div className="more muted small" onClick={() => onOpenDay(day)}>+{sorted.length - 4} more</div>}
    </div>
  );
}

function MonthGrid({ anchor, onOpenDay }) {
  const { state } = useStore();
  const first = parseDay(anchor);
  first.setDate(1);
  const month = first.getMonth();
  const start = startOfWeek(dayStr(first));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const tasks = Object.values(state.tasks);
  const onDay = (d) => tasks.filter((t) => (t.start ? t.start.slice(0, 10) === d : t.day === d));
  return (
    <div className="month-grid">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => <div key={n} className="month-head muted">{n}</div>)}
      {days.map((d) => <MonthCell key={d} day={d} inMonth={parseDay(d).getMonth() === month} tasks={onDay(d)} onOpenDay={onOpenDay} />)}
    </div>
  );
}

// Bottom panel: today's tasks (as on the Today screen) that aren't yet on today's timeline.
function TodayPanel() {
  const { state, actions } = useStore();
  const today = todayStr();
  const drop = useTaskDrop((id) => actions.updateTask(id, { day: today, start: '' }));
  const unplaced = (list) => list.filter((t) => t.start.slice(0, 10) !== today);
  const { overdue, planned, dueToday } = todayGroups(state, today);
  const groups = [
    ['Carried over', unplaced(overdue), 'warn-text'],
    ['Planned for today', unplaced(planned), ''],
    ['Due today', unplaced(dueToday), ''],
  ].filter(([, list]) => list.length);

  return (
    <div className={cx('cal-panel-body', drop.over && 'drop-over')} {...drop.props}>
      {groups.length ? groups.map(([label, list, cls]) => (
        <section key={label} className="group">
          <h2 className={cx('group-title', cls)}>{label} <span className="muted">{list.length}</span></h2>
          <div className="list">{list.map((t) => <TaskRow key={t.id} task={t} draggable />)}</div>
        </section>
      )) : (
        <div className="empty small">Everything for today is on the timeline.</div>
      )}
    </div>
  );
}

async function exportPdf(state, ui, mode, anchor) {
  const range = exportRange(mode, anchor);
  const exportedAt = new Date();
  const html = buildCalendarHtml(state, range, exportedAt);
  if (!window.api?.exportPdf) {
    // Browser fallback (dev preview): open the page and use the print dialog.
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.__fit?.();
    w.print();
    return;
  }
  const res = await window.api.exportPdf({ html, filename: exportFilename(range, exportedAt), landscape: mode === 'week' });
  if (res.canceled) return;
  const warn = res.issues.length ? ` Some text may be cut off: ${res.issues.join(', ')}.` : '';
  if (await ui.confirm({ title: 'Calendar exported', message: `Saved to ${res.filePath}.${warn}`, okLabel: 'Open PDF' })) window.api.openExport();
}

export default function Calendar() {
  const { state } = useStore();
  const ui = useUI();
  const [mode, setMode] = useState(() => loadPref('pp-cal-mode', 'week'));
  const [anchor, setAnchor] = useState(todayStr());
  const [panelH, setPanelH] = useState(() => loadPref('pp-cal-panel', 260));
  const [panelOpen, setPanelOpen] = useState(() => loadPref('pp-cal-panel-open', true));
  const [hourH, setHourH] = useState(() => loadPref('pp-cal-zoom', DEFAULT_HOUR_H));

  useEffect(() => savePref('pp-cal-mode', mode), [mode]);
  useEffect(() => savePref('pp-cal-panel', panelH), [panelH]);
  useEffect(() => savePref('pp-cal-panel-open', panelOpen), [panelOpen]);
  useEffect(() => savePref('pp-cal-zoom', hourH), [hourH]);

  const step = (dir) => {
    if (mode === 'day') setAnchor(addDays(anchor, dir));
    else if (mode === 'week') setAnchor(addDays(anchor, dir * 7));
    else {
      const d = parseDay(anchor);
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
      setAnchor(dayStr(d));
    }
  };

  const ad = parseDay(anchor);
  let title;
  let days = [anchor];
  if (mode === 'week') {
    const s = startOfWeek(anchor);
    days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    const a = parseDay(days[0]);
    const b = parseDay(days[6]);
    title = a.getMonth() === b.getMonth()
      ? `${a.getDate()}–${b.getDate()} ${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}`
      : `${a.getDate()} ${MONTH_NAMES[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTH_NAMES[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`;
  } else if (mode === 'day') {
    title = `${FULL_DAY_NAMES[ad.getDay()]} ${ad.getDate()} ${MONTH_NAMES[ad.getMonth()]} ${ad.getFullYear()}`;
  } else {
    title = `${MONTH_NAMES[ad.getMonth()]} ${ad.getFullYear()}`;
  }

  const startDrag = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelH;
    const move = (m) => setPanelH(Math.min(window.innerHeight - 200, Math.max(120, startH - (m.clientY - startY))));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="calendar-view">
      <header className="view-head cal-head">
        <h1>{title}</h1>
        <div className="spacer" />
        <button
          className="btn small"
          onClick={(e) => ui.openMenu(e, [
            { label: 'Export day', hint: `${DAY_NAMES[ad.getDay()]} ${ad.getDate()} ${MONTH_NAMES[ad.getMonth()].slice(0, 3)}`, onClick: () => exportPdf(state, ui, 'day', anchor) },
            { label: 'Export week', hint: `from ${parseDay(startOfWeek(anchor)).getDate()} ${MONTH_NAMES[parseDay(startOfWeek(anchor)).getMonth()].slice(0, 3)}`, onClick: () => exportPdf(state, ui, 'week', anchor) },
          ])}
        >
          Export PDF
        </button>
        <button className="btn small" onClick={() => setAnchor(todayStr())}>Today</button>
        <button className="icon-btn" onClick={() => step(-1)}>‹</button>
        <button className="icon-btn" onClick={() => step(1)}>›</button>
        {mode !== 'month' && (
          <div className="cal-zoom" title="Zoom time (Ctrl + scroll)">
            <button className="icon-btn" disabled={hourH <= ZOOM_LEVELS[0]} onClick={() => setHourH((h) => zoomStep(h, -1))}>−</button>
            <button className="cal-zoom-label" onClick={() => setHourH(DEFAULT_HOUR_H)} title="Reset zoom">{Math.round((hourH / DEFAULT_HOUR_H) * 100)}%</button>
            <button className="icon-btn" disabled={hourH >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} onClick={() => setHourH((h) => zoomStep(h, 1))}>+</button>
          </div>
        )}
        <div className="segmented">
          {['day', 'week', 'month'].map((m) => (
            <button key={m} className={cx(mode === m && 'active')} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
      </header>
      <div className="cal-main">
        {mode === 'month' ? <MonthGrid anchor={anchor} onOpenDay={(d) => { setAnchor(d); setMode('day'); }} /> : <TimeGrid key={mode} days={days} hourH={hourH} setHourH={setHourH} />}
      </div>
      <div className="cal-panel" style={{ height: panelOpen ? panelH : 34 }}>
        <div className="cal-panel-handle" onMouseDown={panelOpen ? startDrag : undefined}>
          <span className="muted small"><b>Today</b> · drag tasks onto the calendar · drop an event here to unschedule it · double-click a time slot to create</span>
          <button className="icon-btn" onClick={() => setPanelOpen(!panelOpen)} onMouseDown={(e) => e.stopPropagation()}>{panelOpen ? '▾' : '▴'}</button>
        </div>
        {panelOpen && <TodayPanel />}
      </div>
    </div>
  );
}
