import { useState } from 'react';
import { useStore, runningLog, subtasksOf, taskProjectId, logDuration, useNow } from '../store';
import { useUI } from '../ui';
import { taskMenu } from '../menus';
import { fmtDay, fmtTime, fmtMinutes, fmtDuration, colorFor, todayStr, cx } from '../util';

export function Checkbox({ checked, onChange, title }) {
  return (
    <button
      type="button"
      className={cx('checkbox', checked && 'checked')}
      title={title || (checked ? 'Mark incomplete' : 'Mark complete')}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
    >
      {checked ? '✓' : ''}
    </button>
  );
}

export function TimerButton({ task }) {
  const store = useStore();
  const running = runningLog(store.state);
  const isRunning = running?.taskId === task.id;
  if (task.completed) return null;
  return (
    <button
      type="button"
      className={cx('icon-btn timer-btn', isRunning && 'running')}
      title={isRunning ? 'Stop timer' : 'Start timer'}
      onClick={(e) => {
        e.stopPropagation();
        isRunning ? store.actions.stopTimer() : store.actions.startTimer(task.id);
      }}
    >
      {isRunning ? '■' : '▶'}
    </button>
  );
}

function RunningTime({ log }) {
  const now = useNow(1000);
  return <span className="chip running-chip">● {fmtDuration(logDuration(log, now), { seconds: true })}</span>;
}

export function ProjectChip({ projectId, onClick }) {
  const { state } = useStore();
  const p = state.projects[projectId];
  if (!p) return null;
  return (
    <span className="chip project-chip" onClick={onClick} title="Project">
      <span className="dot" style={{ background: colorFor(p.id) }} />
      {p.name}
    </span>
  );
}

export function TagChips({ tags, onClick }) {
  return tags.map((t) => (
    <span key={t} className="chip tag-chip" onClick={onClick ? (e) => { e.stopPropagation(); onClick(t); } : undefined}>#{t}</span>
  ));
}

export default function TaskRow({
  task,
  depth = 0,
  showProject = true,
  showCheckbox = true,
  showSubtasks = true,
  draggable = false,
  inInboxView = false,
  extra = null,
}) {
  const store = useStore();
  const { state, actions } = store;
  const ui = useUI();
  const [expanded, setExpanded] = useState(false);
  const subs = showSubtasks ? subtasksOf(state, task.id) : [];
  const openSubs = subs.filter((s) => !s.completed).length;
  const running = runningLog(state);
  const isRunning = running?.taskId === task.id;
  const today = todayStr();
  const overdue = task.dueDate && task.dueDate < today && !task.completed;
  const projectId = taskProjectId(state, task);

  return (
    <>
      <div
        className={cx('task-row', task.completed && 'completed', isRunning && 'is-running', state.alerts.includes(task.id) && 'is-alert')}
        style={{ paddingLeft: 10 + depth * 22 }}
        onClick={() => ui.openTask(task.id)}
        onContextMenu={(e) => ui.openMenu(e, taskMenu(task, store, ui, { inInboxView }))}
        draggable={draggable}
        onDragStart={draggable ? (e) => {
          e.dataTransfer.setData('application/x-task', task.id);
          e.dataTransfer.effectAllowed = 'move';
        } : undefined}
      >
        {subs.length > 0 ? (
          <button type="button" className="icon-btn expander" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? '▾' : '▸'}
          </button>
        ) : <span className="expander-space" />}
        {showCheckbox && <Checkbox checked={task.completed} onChange={() => actions.toggleComplete(task.id)} />}
        {task.priority > 0 && <span className={'prio prio-' + task.priority} title="Priority">{'!'.repeat(task.priority)}</span>}
        <div className="task-main">
          <div className="task-title">{task.title || <span className="muted">Untitled</span>}</div>
          {task.nextAction && !task.completed && <div className="next-action">→ {task.nextAction}</div>}
        </div>
        <div className="task-meta">
          {isRunning && <RunningTime log={running} />}
          {subs.length > 0 && <span className="chip" title="Open subtasks">{openSubs}/{subs.length}</span>}
          {showProject && projectId && (
            <ProjectChip projectId={projectId} onClick={(e) => { e.stopPropagation(); ui.navigate('project', projectId); }} />
          )}
          <TagChips tags={task.tags} onClick={(t) => ui.navigate('tags', t)} />
          {task.start && <span className="chip" title="Scheduled">◷ {task.start.slice(0, 10) === today ? fmtTime(task.start) : `${fmtDay(task.start.slice(0, 10))} ${fmtTime(task.start)}`}</span>}
          {task.day && !task.start && <span className={cx('chip', task.day < today && !task.completed && 'warn')} title="Assigned day">☀ {fmtDay(task.day)}</span>}
          {task.dueDate && <span className={cx('chip', overdue && 'danger')} title="Due">⚑ {fmtDay(task.dueDate)}</span>}
          {task.estimate ? <span className="chip" title="Estimate">~{fmtMinutes(task.estimate)}</span> : null}
          {extra}
          <TimerButton task={task} />
        </div>
      </div>
      {expanded && subs.map((s) => (
        <TaskRow key={s.id} task={s} depth={depth + 1} showProject={false} showCheckbox={showCheckbox} inInboxView={inInboxView} draggable={draggable} />
      ))}
    </>
  );
}
