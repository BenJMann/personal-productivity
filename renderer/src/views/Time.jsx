import { useEffect, useRef, useState } from 'react';
import { useStore, useNow, folderPath } from '../store';
import { useUI } from '../ui';
import { todayStr, addDays, startOfWeek, parseDay, DAY_NAMES, MONTH_NAMES, colorFor, fmtDuration, cx } from '../util';

const HOUR_H = 40;
const pad = (n) => String(n).padStart(2, '0');

function periodRange(period) {
  const today = todayStr();
  const t = (s) => parseDay(s).getTime();
  if (period === 'today') return [t(today), t(addDays(today, 1))];
  if (period === 'week') { const s = startOfWeek(today); return [t(s), t(addDays(s, 7))]; }
  if (period === 'month') {
    const d = parseDay(today);
    return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
  }
  return [0, Infinity];
}

// Portion of a log that falls inside [a, b).
function clipped(log, a, b, now) {
  const s = new Date(log.start).getTime();
  const e = log.end ? new Date(log.end).getTime() : now;
  return Math.max(0, Math.min(e, b) - Math.max(s, a));
}

function Bar({ value, max, color }) {
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} />
    </div>
  );
}

function ByProject({ focusId }) {
  const { state } = useStore();
  const ui = useUI();
  const now = useNow(5000);
  const [period, setPeriod] = useState('week');
  const [expanded, setExpanded] = useState(focusId ? { [focusId]: true } : {});
  const [a, b] = periodRange(period);

  const perProject = {};
  const perTask = {};
  for (const log of state.timeLogs) {
    const ms = clipped(log, a, b, now);
    if (!ms) continue;
    const pid = log.projectId || '~none';
    perProject[pid] = (perProject[pid] || 0) + ms;
    perTask[pid] = perTask[pid] || {};
    perTask[pid][log.taskId] = (perTask[pid][log.taskId] || 0) + ms;
  }
  // Roll project time up into every enclosing folder.
  const perFolder = {};
  for (const [pid, ms] of Object.entries(perProject)) {
    const p = state.projects[pid];
    if (!p) continue;
    folderPath(state, p.folderId).forEach((f) => { perFolder[f.id] = (perFolder[f.id] || 0) + ms; });
  }
  const total = Object.values(perProject).reduce((s, x) => s + x, 0);
  const max = Math.max(0, ...Object.values(perProject));

  const projectRow = (pid, depth) => {
    const p = state.projects[pid];
    const ms = perProject[pid] || 0;
    const color = p ? colorFor(pid) : 'var(--text-3)';
    const tasks = Object.entries(perTask[pid] || {}).sort((x, y) => y[1] - x[1]);
    return (
      <div key={pid} className={cx('time-row-wrap', focusId === pid && 'focused')}>
        <div className="time-row" style={{ paddingLeft: 10 + depth * 18 }} onClick={() => setExpanded({ ...expanded, [pid]: !expanded[pid] })}>
          <span className="muted small">{expanded[pid] ? '▾' : '▸'}</span>
          <span className="dot" style={{ background: color }} />
          <span className={cx('time-name', p && 'link')} onClick={p ? (e) => { e.stopPropagation(); ui.navigate('project', pid); } : undefined}>{p ? p.name : 'No project'}</span>
          <Bar value={ms} max={max} color={color} />
          <span className="time-val">{fmtDuration(ms)}</span>
        </div>
        {expanded[pid] && tasks.map(([tid, tms]) => (
          <div key={tid} className="time-row sub" style={{ paddingLeft: 46 + depth * 18 }} onClick={() => state.tasks[tid] && ui.openTask(tid)}>
            <span className="time-name">{state.tasks[tid]?.title || <span className="muted">Deleted task</span>}</span>
            <Bar value={tms} max={max} color={color} />
            <span className="time-val">{fmtDuration(tms)}</span>
          </div>
        ))}
      </div>
    );
  };

  const folderRows = (parentId, depth) => {
    const folders = Object.values(state.folders).filter((f) => (f.parentId || null) === parentId && perFolder[f.id]).sort((x, y) => perFolder[y.id] - perFolder[x.id]);
    const projects = Object.keys(perProject).filter((pid) => state.projects[pid] && (state.projects[pid].folderId || null) === parentId).sort((x, y) => perProject[y] - perProject[x]);
    return (
      <>
        {folders.map((f) => (
          <div key={f.id}>
            <div className="time-row folder" style={{ paddingLeft: 10 + depth * 18 }}>
              <span className="time-name">📁 {f.name}</span>
              <span className="time-val">{fmtDuration(perFolder[f.id])}</span>
            </div>
            {folderRows(f.id, depth + 1)}
          </div>
        ))}
        {projects.map((pid) => projectRow(pid, depth))}
      </>
    );
  };

  // Logs whose project has since been deleted still count, under "No project".
  const orphanIds = Object.keys(perProject).filter((pid) => pid !== '~none' && !state.projects[pid]);
  orphanIds.forEach((pid) => { perProject['~none'] = (perProject['~none'] || 0) + perProject[pid]; delete perProject[pid]; });

  return (
    <div>
      <div className="row toolbar">
        <div className="segmented">
          {[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']].map(([v, l]) => (
            <button key={v} className={cx(period === v && 'active')} onClick={() => setPeriod(v)}>{l}</button>
          ))}
        </div>
        <div className="spacer" />
        <span className="total-time">Total <strong>{fmtDuration(total)}</strong></span>
      </div>
      {total === 0 ? (
        <div className="empty small">No time tracked in this period. Press ▶ on any task to start its timer.</div>
      ) : (
        <div className="time-table">
          {folderRows(null, 0)}
          {perProject['~none'] ? projectRow('~none', 0) : null}
        </div>
      )}
    </div>
  );
}

function Days() {
  const { state, actions } = useStore();
  const ui = useUI();
  const now = useNow(30000);
  const [weekStart, setWeekStart] = useState(startOfWeek(todayStr()));
  const [selected, setSelected] = useState(todayStr());
  const scrollRef = useRef(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H; }, []);

  const blocksFor = (d) => {
    const a = parseDay(d).getTime();
    const b = parseDay(addDays(d, 1)).getTime();
    return state.timeLogs
      .map((l) => {
        const s = Math.max(new Date(l.start).getTime(), a);
        const e = Math.min(l.end ? new Date(l.end).getTime() : now, b);
        return e > s ? { log: l, s, e, ms: e - s } : null;
      })
      .filter(Boolean);
  };

  const a = parseDay(days[0]);
  const selectedBlocks = blocksFor(selected).sort((x, y) => x.s - y.s);

  return (
    <div>
      <div className="row toolbar">
        <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
        <button className="btn small" onClick={() => { setWeekStart(startOfWeek(todayStr())); setSelected(todayStr()); }}>This week</button>
        <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
        <span className="muted">Week of {a.getDate()} {MONTH_NAMES[a.getMonth()]} {a.getFullYear()}</span>
      </div>
      <div className="days-grid">
        <div className="tg-head" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
          <div />
          {days.map((d) => {
            const dt = parseDay(d);
            const total = blocksFor(d).reduce((s, x) => s + x.ms, 0);
            return (
              <div key={d} className={cx('tg-day-head clickable', d === selected && 'selected', d === todayStr() && 'today')} onClick={() => setSelected(d)}>
                <div><span className="muted">{DAY_NAMES[dt.getDay()]}</span> <span className="day-num">{dt.getDate()}</span></div>
                <div className="small">{total ? fmtDuration(total) : <span className="muted">—</span>}</div>
              </div>
            );
          })}
        </div>
        <div className="tg-scroll short" ref={scrollRef}>
          <div className="tg-body" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
            <div className="hour-labels" style={{ height: 24 * HOUR_H }}>
              {Array.from({ length: 24 }, (_, h) => <div key={h} className="hour-label" style={{ top: h * HOUR_H }}>{h ? `${pad(h)}:00` : ''}</div>)}
            </div>
            {days.map((d) => {
              const dayStart = parseDay(d).getTime();
              return (
                <div key={d} className={cx('day-col', d === selected && 'selected')} style={{ height: 24 * HOUR_H }} onClick={() => setSelected(d)}>
                  {Array.from({ length: 24 }, (_, h) => <div key={h} className="hour-line" style={{ top: h * HOUR_H }} />)}
                  {blocksFor(d).map(({ log, s, ms }) => {
                    const color = colorFor(log.projectId);
                    const task = state.tasks[log.taskId];
                    return (
                      <div
                        key={log.id}
                        className={cx('cal-event log-block', !log.end && 'live')}
                        style={{ top: ((s - dayStart) / 3600000) * HOUR_H, height: Math.max(3, (ms / 3600000) * HOUR_H), borderLeftColor: color, background: `color-mix(in srgb, ${color} 30%, var(--bg-2))` }}
                        title={`${task?.title || 'Deleted task'} — ${fmtDuration(ms)}`}
                      >
                        {ms > 20 * 60000 && <div className="ev-title">{task?.title}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <section className="group">
        <h2 className="group-title">Entries for {selected === todayStr() ? 'today' : selected}</h2>
        {selectedBlocks.length === 0 && <div className="empty small">No time tracked on this day.</div>}
        <div className="list">
          {selectedBlocks.map(({ log, s, e, ms }) => {
            const task = state.tasks[log.taskId];
            const project = state.projects[log.projectId];
            const t = (x) => { const d = new Date(x); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
            return (
              <div key={log.id} className="task-row" onClick={() => task && ui.openTask(task.id)}>
                <span className="dot" style={{ background: colorFor(log.projectId) }} />
                <span className="mono muted">{t(s)}–{log.end ? t(e) : 'now'}</span>
                <div className="task-main"><div className="task-title">{task?.title || <span className="muted">Deleted task</span>}</div></div>
                <div className="task-meta">
                  {project && <span className="chip">{project.name}</span>}
                  <span className="chip">{fmtDuration(ms)}</span>
                  <button
                    className="icon-btn"
                    title="Delete entry"
                    onClick={async (ev) => {
                      ev.stopPropagation();
                      if (await ui.confirm({ title: 'Delete time entry?', message: 'This removes the tracked time permanently.', okLabel: 'Delete', danger: true })) actions.deleteLog(log.id);
                    }}
                  >✕</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default function Time({ projectId }) {
  const [tab, setTab] = useState('projects');
  useEffect(() => { if (projectId) setTab('projects'); }, [projectId]);
  return (
    <div className="view">
      <header className="view-head">
        <h1>Time tracking</h1>
        <div className="spacer" />
        <div className="segmented">
          <button className={cx(tab === 'projects' && 'active')} onClick={() => setTab('projects')}>By project</button>
          <button className={cx(tab === 'days' && 'active')} onClick={() => setTab('days')}>Days</button>
        </div>
      </header>
      {tab === 'projects' ? <ByProject key={projectId || 'all'} focusId={projectId} /> : <Days />}
    </div>
  );
}
