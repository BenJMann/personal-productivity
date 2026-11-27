import { useState } from 'react';
import { useStore, taskProjectId, subtasksOf, folderPath } from '../store';
import { useUI } from '../ui';
import { taskMenu, projectMenu } from '../menus';
import QuickEntry from '../components/QuickEntry';
import { ProjectChip, TagChips } from '../components/TaskRow';
import TagInput from '../components/TagInput';
import { ProjectSelect, FolderSelect, PrioritySelect } from '../components/Selects';
import { todayStr, addDays, colorFor, fmtDay, fmtDateTime, fmtMinutes, cx } from '../util';

// Two-line summary; everything else is in the right-click menu or the expanded panel.
function InboxItem({ expanded, setExpanded, onContextMenu, onOpen, title, badge, chips, line2, onProcessed, children }) {
  return (
    <div className={cx('inbox-item', expanded && 'expanded')} onContextMenu={onContextMenu}>
      <div className="inbox-line1">
        <button className="icon-btn expander" title={expanded ? 'Collapse' : 'Show all options'} onClick={() => setExpanded(!expanded)}>
          {expanded ? '▾' : '▸'}
        </button>
        {badge}
        <span className="inbox-item-title" onClick={onOpen}>{title}</span>
        <div className="inbox-chips">{chips}</div>
        <button className="btn small process-btn" onClick={onProcessed} title="Processing complete — remove from the inbox">✓ Processed</button>
        <button className="icon-btn" title="All options" onClick={onContextMenu}>⋯</button>
      </div>
      <div className="inbox-line2" onClick={() => setExpanded(!expanded)}>{line2}</div>
      {expanded && <div className="inbox-expanded">{children}</div>}
    </div>
  );
}

function InboxTask({ task }) {
  const store = useStore();
  const { state, actions } = store;
  const ui = useUI();
  const set = (patch) => actions.updateTask(task.id, patch);
  const today = todayStr();
  const subCount = subtasksOf(state, task.id).length;

  const [expanded, setExpanded] = useState(false);
  const projectId = taskProjectId(state, task);
  const menu = (e) => ui.openMenu(e, taskMenu(task, store, ui, { inInboxView: true }));
  const firstNote = task.notes.split('\n').find((l) => l.trim());

  const chips = (
    <>
      {task.priority > 0 && <span className={'prio prio-' + task.priority} title="Priority">{'!'.repeat(task.priority)}</span>}
      {task.parentId && <span className="chip" title="Subtask of">↳ {state.tasks[task.parentId]?.title}</span>}
      {projectId && <ProjectChip projectId={projectId} onClick={(e) => { e.stopPropagation(); ui.navigate('project', projectId); }} />}
      <TagChips tags={task.tags} onClick={(t) => ui.navigate('tags', t)} />
      {task.start && <span className="chip" title="Start time">◷ {fmtDateTime(task.start)}</span>}
      {task.day && !task.start && <span className="chip" title="Assigned day">☀ {fmtDay(task.day)}</span>}
      {task.dueDate && <span className={cx('chip', task.dueDate < today && 'danger')} title="Due">⚑ {fmtDay(task.dueDate)}</span>}
      {task.estimate ? <span className="chip" title="Estimate">~{fmtMinutes(task.estimate)}</span> : null}
      {subCount > 0 && <span className="chip" title="Subtasks">{subCount} subtask{subCount > 1 ? 's' : ''}</span>}
    </>
  );
  const line2 = (
    <>
      {task.nextAction ? <span className="next-action">→ {task.nextAction}</span> : <span className="muted">No next action</span>}
      {firstNote && <span className="muted inbox-note"> · {firstNote}</span>}
    </>
  );

  return (
    <InboxItem
      expanded={expanded}
      setExpanded={setExpanded}
      onContextMenu={menu}
      onOpen={() => ui.openTask(task.id)}
      title={task.title || <span className="muted">Untitled</span>}
      chips={chips}
      line2={line2}
      onProcessed={() => actions.processComplete('task', task.id)}
    >
      <div className="inbox-card-head">
        <input className="inbox-title" value={task.title} onChange={(e) => set({ title: e.target.value })} />
        <button className="btn ghost small" onClick={() => ui.openTask(task.id)}>Details{subCount ? ` · ${subCount} subtasks` : ''}</button>
      </div>
      <div className="inbox-grid">
        <label>Next action</label>
        <input className="wide" value={task.nextAction} placeholder="Optional — leave blank if it's obvious" onChange={(e) => set({ nextAction: e.target.value })} />

        <label>Project</label>
        <div className="row wide">
          {task.parentId ? <span className="muted">Subtask of {state.tasks[task.parentId]?.title}</span> : <ProjectSelect value={task.projectId} onChange={(v) => set({ projectId: v })} />}
          {!task.parentId && (
            <>
              <button
                className="btn ghost small"
                title="Create a project with its own name and move this task into it"
                onClick={async () => {
                  const name = await ui.prompt({ title: 'New project', label: `"${task.title}" will be moved into it`, placeholder: 'Project name' });
                  if (name) actions.moveTaskToNewProject(task.id, name);
                }}
              >
                + New project…
              </button>
              <button
                className="btn ghost small"
                title="Turn this task itself into a project (it stays in the inbox)"
                onClick={async () => {
                  const name = await ui.prompt({ title: 'Convert to project', label: 'Project name', value: task.title, okLabel: 'Convert' });
                  if (name) actions.convertTaskToProject(task.id, name);
                }}
              >
                Convert to project…
              </button>
            </>
          )}
        </div>

        <label>Do on day</label>
        <div className="row">
          <input type="date" value={task.day} onChange={(e) => set({ day: e.target.value })} />
          <button className={'btn ghost small' + (task.day === today ? ' active' : '')} onClick={() => set({ day: today })}>Today</button>
          <button className={'btn ghost small' + (task.day === addDays(today, 1) ? ' active' : '')} onClick={() => set({ day: addDays(today, 1) })}>Tomorrow</button>
          {task.day && <button className="btn ghost small" onClick={() => set({ day: '' })}>Clear</button>}
        </div>

        <label>Due</label>
        <input type="date" value={task.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />

        <label>Priority</label>
        <PrioritySelect value={task.priority} onChange={(v) => set({ priority: v })} />

        <label>Tags</label>
        <TagInput tags={task.tags} onChange={(tags) => set({ tags })} />
      </div>
    </InboxItem>
  );
}

function InboxProject({ project }) {
  const store = useStore();
  const { state, actions } = store;
  const ui = useUI();
  const set = (patch) => actions.updateProject(project.id, patch);
  const tasks = Object.values(state.tasks).filter((t) => !t.completed && !t.parentId && taskProjectId(state, t) === project.id);
  const withNext = tasks.filter((t) => t.nextAction).length;

  const [expanded, setExpanded] = useState(false);
  const color = colorFor(project.id);
  const folder = folderPath(state, project.folderId).map((f) => f.name).join(' / ');

  const chips = (
    <>
      {folder && <span className="chip" title="Folder">📁 {folder}</span>}
      <TagChips tags={project.tags} onClick={(t) => ui.navigate('tags', t)} />
      {project.dueDate && <span className="chip" title="Due">⚑ {fmtDay(project.dueDate)}</span>}
      <span className="chip">{tasks.length} open · {withNext} with next actions</span>
    </>
  );
  const line2 = (
    <>
      {tasks.length > 0 && withNext === 0 && <span className="warn-text">Nothing is moving · </span>}
      {tasks.length ? <span className="muted">{tasks.map((t) => t.title).join(' · ')}</span> : <span className="muted">No tasks yet</span>}
    </>
  );

  return (
    <InboxItem
      expanded={expanded}
      setExpanded={setExpanded}
      onContextMenu={(e) => ui.openMenu(e, projectMenu(project, store, ui))}
      onOpen={() => ui.navigate('project', project.id)}
      badge={<span className="kind-badge project" style={{ borderColor: color, color }}>Project</span>}
      title={project.name}
      chips={chips}
      line2={line2}
      onProcessed={() => actions.processComplete('project', project.id)}
    >
      <div className="inbox-card-head">
        <input className="inbox-title" value={project.name} onChange={(e) => set({ name: e.target.value })} />
        <button className="btn ghost small" onClick={() => ui.navigate('project', project.id)}>Open</button>
      </div>
      <div className="inbox-grid">
        <label>Folder</label>
        <FolderSelect value={project.folderId} onChange={(v) => set({ folderId: v })} />
        <label>Tags</label>
        <TagInput tags={project.tags} onChange={(tags) => set({ tags })} />
        <label>Tasks</label>
        <div className="muted wide">
          {tasks.length} open task{tasks.length === 1 ? '' : 's'}, {withNext} with next actions
          {tasks.length > 0 && withNext === 0 && <span className="warn-text"> — nothing is moving</span>}
        </div>
      </div>
      <div className="project-card-tasks">
        {tasks.slice(0, 6).map((t) => (
          <div key={t.id} className="mini-task" onClick={() => ui.openTask(t.id)} onContextMenu={(e) => ui.openMenu(e, taskMenu(t, store, ui))}>
            <span>{t.title}</span>
            {t.nextAction ? <span className="next-action">→ {t.nextAction}</span> : <span className="muted small">no next action</span>}
          </div>
        ))}
        {tasks.length > 6 && <div className="muted small">…and {tasks.length - 6} more</div>}
        <QuickEntry defaults={{ projectId: project.id }} placeholder={`Add a task to ${project.name}…`} hint={false} />
      </div>
    </InboxItem>
  );
}

export default function Inbox() {
  const { state } = useStore();
  const tasks = Object.values(state.tasks).filter((t) => t.inbox).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const projects = Object.values(state.projects).filter((p) => p.inbox);
  const empty = !tasks.length && !projects.length;

  return (
    <div className="view">
      <header className="view-head">
        <h1>Inbox</h1>
        <span className="muted">{tasks.length + projects.length} to process</span>
      </header>
      <QuickEntry defaults={{ inbox: true }} autoFocus />
      {empty ? (
        <div className="empty">
          <div className="empty-icon">✓</div>
          <div>Inbox zero. Everything has a place.</div>
          <div className="muted small">Capture new stuff above, or right-click anything that's stalled and choose "Move to inbox".</div>
        </div>
      ) : (
        <div className="inbox-list">
          {projects.map((p) => <InboxProject key={p.id} project={p} />)}
          {tasks.map((t) => <InboxTask key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}
