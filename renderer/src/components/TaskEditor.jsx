import { useEffect, useState } from 'react';
import { useStore, subtasksOf, timeForTask, useNow, runningLog } from '../store';
import { useUI } from '../ui';
import { taskMenu } from '../menus';
import TaskRow, { Checkbox, TimerButton } from './TaskRow';
import TagInput from './TagInput';
import QuickEntry from './QuickEntry';
import { ProjectSelect, PrioritySelect } from './Selects';
import { todayStr, addDays, fmtDuration, fmtDay } from '../util';

const ESTIMATES = [15, 30, 60, 120, 240];

export default function TaskEditor({ id }) {
  const store = useStore();
  const { state, actions } = store;
  const ui = useUI();
  const task = state.tasks[id];
  const now = useNow(runningLog(state)?.taskId === id ? 1000 : 60000);
  const [nextDraft, setNextDraft] = useState(null);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal')) ui.openTask(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [ui]);

  useEffect(() => setNextDraft(null), [id]);

  if (!task) return null;
  const set = (patch) => actions.updateTask(id, patch);
  const parent = task.parentId ? state.tasks[task.parentId] : null;
  const subs = subtasksOf(state, id);
  const spent = timeForTask(state, id, now);
  const today = todayStr();

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) ui.openTask(null); }}>
      <aside className="drawer">
        <div className="drawer-head">
          <Checkbox checked={task.completed} onChange={() => actions.toggleComplete(id)} />
          <input className="title-input" value={task.title} placeholder="Task title" onChange={(e) => set({ title: e.target.value })} autoFocus={!task.title} />
          <TimerButton task={task} />
          <button className="icon-btn" title="More" onClick={(e) => ui.openMenu(e, taskMenu(task, store, ui))}>⋯</button>
          <button className="icon-btn" title="Close (Esc)" onClick={() => ui.openTask(null)}>✕</button>
        </div>

        {parent && (
          <div className="breadcrumb">Subtask of <a onClick={() => ui.openTask(parent.id)}>{parent.title}</a></div>
        )}

        {task.inbox && (
          <div className="inbox-strip">
            <span>📥 In the inbox — waiting to be processed</span>
            <button className="btn primary small" onClick={() => actions.processComplete('task', id)}>Processing complete</button>
          </div>
        )}

        <div className="drawer-body">
          <section className="next-action-box">
            <label className="section-label">Next action</label>
            {nextDraft === null ? (
              <div className="row">
                <input value={task.nextAction} placeholder="What's the very next physical step? (optional)" onChange={(e) => set({ nextAction: e.target.value })} />
                {task.nextAction && (
                  <button className="btn small" title="Mark this next action done and set the following one" onClick={() => setNextDraft('')}>Done → next</button>
                )}
              </div>
            ) : (
              <form className="row" onSubmit={(e) => { e.preventDefault(); actions.completeNextAction(id, nextDraft.trim()); setNextDraft(null); }}>
                <span className="muted strike">{task.nextAction}</span>
                <input autoFocus value={nextDraft} placeholder="New next action (leave blank for none)" onChange={(e) => setNextDraft(e.target.value)} />
                <button className="btn primary small" type="submit">Save</button>
                <button className="btn ghost small" type="button" onClick={() => setNextDraft(null)}>Cancel</button>
              </form>
            )}
            {task.nextActionHistory.length > 0 && (
              <details className="history">
                <summary>{task.nextActionHistory.length} completed next action{task.nextActionHistory.length > 1 ? 's' : ''}</summary>
                {[...task.nextActionHistory].reverse().map((h, i) => (
                  <div key={i} className="history-item"><span className="strike">{h.text}</span> <span className="muted">{fmtDay(h.doneAt.slice(0, 10))}</span></div>
                ))}
              </details>
            )}
          </section>

          <div className="form-grid">
            <label>Project</label>
            <div>
              {parent ? <span className="muted">Inherited from parent task</span> : <ProjectSelect value={task.projectId} onChange={(v) => set({ projectId: v })} />}
            </div>

            <label>Do on day</label>
            <div className="row">
              <input type="date" value={task.day} onChange={(e) => set({ day: e.target.value })} />
              <button className="btn ghost small" onClick={() => set({ day: today })}>Today</button>
              <button className="btn ghost small" onClick={() => set({ day: addDays(today, 1) })}>Tomorrow</button>
              {task.day && <button className="btn ghost small" onClick={() => set({ day: '' })}>Clear</button>}
            </div>

            <label>Start time</label>
            <div className="row">
              <input type="datetime-local" value={task.start} onChange={(e) => set({ start: e.target.value, day: e.target.value ? e.target.value.slice(0, 10) : task.day })} />
              {task.start && <button className="btn ghost small" onClick={() => set({ start: '' })}>Clear</button>}
            </div>

            <label>Due date</label>
            <div className="row">
              <input type="date" value={task.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
              {task.dueDate && <button className="btn ghost small" onClick={() => set({ dueDate: '' })}>Clear</button>}
            </div>

            <label>Estimate</label>
            <div className="row">
              <input type="number" min="0" step="5" className="narrow" value={task.estimate ?? ''} placeholder="min" onChange={(e) => set({ estimate: e.target.value ? Number(e.target.value) : null })} />
              <span className="muted">min</span>
              {ESTIMATES.map((m) => (
                <button key={m} className={'btn ghost small' + (task.estimate === m ? ' active' : '')} onClick={() => set({ estimate: m })}>
                  {m < 60 ? `${m}m` : `${m / 60}h`}
                </button>
              ))}
            </div>

            <label>Priority</label>
            <PrioritySelect value={task.priority} onChange={(v) => set({ priority: v })} />

            <label>Tags</label>
            <TagInput tags={task.tags} onChange={(tags) => set({ tags })} />

            <label>Time spent</label>
            <div className="row">
              <span>{spent ? fmtDuration(spent) : <span className="muted">Nothing tracked yet</span>}</span>
            </div>
          </div>

          <section>
            <label className="section-label">Notes</label>
            <textarea rows={5} value={task.notes} placeholder="Notes, links, context…" onChange={(e) => set({ notes: e.target.value })} />
          </section>

          <section>
            <label className="section-label">Subtasks</label>
            <div className="list">
              {subs.map((s) => <TaskRow key={s.id} task={s} showProject={false} />)}
            </div>
            <QuickEntry defaults={{ parentId: id }} placeholder="Add a subtask…" hint={false} />
          </section>
        </div>
      </aside>
    </div>
  );
}
