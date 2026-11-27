import { useStore } from '../store';
import TaskRow from '../components/TaskRow';
import QuickEntry from '../components/QuickEntry';
import { todayStr, parseDay, DAY_NAMES, FULL_DAY_NAMES, MONTH_NAMES } from '../util';

const byTimeThenPriority = (a, b) => {
  if (a.start && b.start) return a.start.localeCompare(b.start);
  if (a.start) return -1;
  if (b.start) return 1;
  return b.priority - a.priority || a.order - b.order;
};

// The open task groups shown on the Today screen (also used by the calendar's bottom panel).
export function todayGroups(state, today = todayStr()) {
  const all = Object.values(state.tasks);
  const isToday = (t) => t.day === today || t.start.slice(0, 10) === today;
  const overdue = all.filter((t) => !t.completed && !isToday(t) && ((t.day && t.day < today) || (t.dueDate && t.dueDate < today))).sort(byTimeThenPriority);
  const planned = all.filter((t) => !t.completed && isToday(t)).sort(byTimeThenPriority);
  const dueToday = all.filter((t) => !t.completed && !isToday(t) && t.dueDate === today && !overdue.includes(t));
  return { overdue, planned, dueToday };
}

export default function Today() {
  const { state } = useStore();
  const today = todayStr();
  const { overdue, planned, dueToday } = todayGroups(state, today);
  const done = Object.values(state.tasks).filter((t) => t.completed && t.completedAt && t.completedAt.slice(0, 10) === today);
  const d = parseDay(today);

  return (
    <div className="view">
      <header className="view-head">
        <h1>Today</h1>
        <span className="muted">{FULL_DAY_NAMES[d.getDay()]}, {d.getDate()} {MONTH_NAMES[d.getMonth()]}</span>
      </header>
      <QuickEntry defaults={{ day: today }} placeholder="Add something to do today…" hint={false} />

      {overdue.length > 0 && (
        <section className="group">
          <h2 className="group-title warn-text">Carried over <span className="muted">{overdue.length}</span></h2>
          <div className="list">{overdue.map((t) => <TaskRow key={t.id} task={t} />)}</div>
        </section>
      )}

      <section className="group">
        <h2 className="group-title">Planned for today <span className="muted">{planned.length}</span></h2>
        {planned.length ? (
          <div className="list">{planned.map((t) => <TaskRow key={t.id} task={t} />)}</div>
        ) : (
          <div className="empty small">Nothing assigned to today. Assign tasks from the inbox, a project, or by right-clicking → Assign to day.</div>
        )}
      </section>

      {dueToday.length > 0 && (
        <section className="group">
          <h2 className="group-title">Due today <span className="muted">{dueToday.length}</span></h2>
          <div className="list">{dueToday.map((t) => <TaskRow key={t.id} task={t} />)}</div>
        </section>
      )}

      {done.length > 0 && (
        <section className="group">
          <h2 className="group-title muted">Done today {done.length}</h2>
          <div className="list">{done.map((t) => <TaskRow key={t.id} task={t} />)}</div>
        </section>
      )}
      <div className="muted small footnote">Tasks assigned to a past day stay under "Carried over" until you finish them or pick a new day.</div>
    </div>
  );
}
