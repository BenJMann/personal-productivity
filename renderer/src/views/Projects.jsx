import { useState } from 'react';
import { useStore, taskProjectId, timeForProject, projectHasNextActions, useNow, childrenOf } from '../store';
import { dragProps, useTreeDrop } from '../components/dnd';
import { useUI } from '../ui';
import { projectMenu, folderMenu } from '../menus';
import TaskRow, { TagChips } from '../components/TaskRow';
import QuickEntry from '../components/QuickEntry';
import TagInput from '../components/TagInput';
import { FolderSelect } from '../components/Selects';
import { colorFor, fmtDuration, fmtDay, todayStr, cx } from '../util';

function ProjectCard({ project, dropClass }) {
  const store = useStore();
  const { state } = store;
  const ui = useUI();
  const tasks = Object.values(state.tasks).filter((t) => !t.parentId && taskProjectId(state, t) === project.id);
  const open = tasks.filter((t) => !t.completed);
  const moving = projectHasNextActions(state, project.id);
  return (
    <div
      {...dragProps('project', project.id)}
      className={cx('project-card-small', project.completed && 'completed', dropClass('project', project.id))}
      onClick={() => ui.navigate('project', project.id)}
      onContextMenu={(e) => ui.openMenu(e, projectMenu(project, store, ui))}
    >
      <span className="grip" title="Drag to reorder">⋮⋮</span>
      <span className="dot" style={{ background: colorFor(project.id) }} />
      <span className="pc-name">{project.name}</span>
      <TagChips tags={project.tags} />
      {project.inbox && <span className="chip">in inbox</span>}
      {open.length > 0 && !moving && <span className="chip warn" title="No open task has a next action">stalled</span>}
      <span className="muted small">{open.length} open</span>
    </div>
  );
}

function FolderContents({ folderId, showCompleted, dropClass }) {
  const store = useStore();
  const ui = useUI();
  const children = childrenOf(store.state, folderId, (p) => showCompleted || !p.completed);
  return children.map(({ kind, item }) =>
    kind === 'project' ? <ProjectCard key={item.id} project={item} dropClass={dropClass} /> : (
      <div key={item.id} className="folder-block">
        <div
          {...dragProps('folder', item.id)}
          className={cx('folder-head', dropClass('folder', item.id))}
          onContextMenu={(e) => ui.openMenu(e, folderMenu(item, store, ui))}
        >
          <span className="grip" title="Drag to reorder">⋮⋮</span>📁 {item.name}
        </div>
        <div className="folder-content">
          <FolderContents folderId={item.id} showCompleted={showCompleted} dropClass={dropClass} />
          {childrenOf(store.state, item.id).length === 0 && <div className="muted small pad">Empty — drag projects here</div>}
        </div>
      </div>
    ));
}

function ProjectTreeEditor({ showCompleted }) {
  const { actions } = useStore();
  const dnd = useTreeDrop(null, {
    onTaskToProject: (taskId, projectId) => actions.updateTask(taskId, { projectId, parentId: null }),
  });
  return (
    <div className={cx('folder-block root', dnd.rootActive && 'drop-root')} {...dnd.containerProps}>
      <FolderContents folderId={null} showCompleted={showCompleted} dropClass={dnd.dropClass} />
    </div>
  );
}

export function ProjectsOverview() {
  const { actions } = useStore();
  const ui = useUI();
  const [showCompleted, setShowCompleted] = useState(false);
  return (
    <div className="view">
      <header className="view-head">
        <h1>Projects</h1>
        <div className="spacer" />
        <label className="toggle"><input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} /> Show completed</label>
        <button className="btn" onClick={async () => { const n = await ui.prompt({ title: 'New folder', placeholder: 'Folder name' }); if (n) actions.addFolder({ name: n }); }}>+ Folder</button>
        <button className="btn primary" onClick={async () => { const n = await ui.prompt({ title: 'New project', placeholder: 'Project name' }); if (n) ui.navigate('project', actions.addProject({ name: n })); }}>+ Project</button>
      </header>
      <p className="muted small">Drag projects and folders to reorder them, or onto the middle of a folder to put them inside. Right-click for more options.</p>
      <ProjectTreeEditor showCompleted={showCompleted} />
    </div>
  );
}

export function ProjectPage({ id }) {
  const store = useStore();
  const { state, actions } = store;
  const ui = useUI();
  const now = useNow(30000);
  const [showDone, setShowDone] = useState(false);
  const project = state.projects[id];
  if (!project) return <div className="view"><div className="empty">Project not found.</div></div>;

  const set = (patch) => actions.updateProject(id, patch);
  const tasks = Object.values(state.tasks).filter((t) => !t.parentId && t.projectId === id).sort((a, b) => b.priority - a.priority || a.order - b.order);
  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);
  const spent = timeForProject(state, id, now);
  const moving = projectHasNextActions(state, id);

  return (
    <div className="view">
      <header className="view-head">
        <span className="dot big" style={{ background: colorFor(id) }} />
        <input className="h1-input" value={project.name} onChange={(e) => set({ name: e.target.value })} />
        <button className="icon-btn" onClick={(e) => ui.openMenu(e, projectMenu(project, store, ui))}>⋯</button>
      </header>

      {project.inbox && (
        <div className="inbox-strip">
          <span>📥 This project is in the inbox</span>
          <button className="btn primary small" onClick={() => actions.processComplete('project', id)}>Processing complete</button>
        </div>
      )}

      <div className="project-meta">
        <div className="meta-item">
          <span className="meta-label">Folder</span>
          <FolderSelect value={project.folderId} onChange={(v) => set({ folderId: v })} />
        </div>
        <div className="meta-item grow">
          <span className="meta-label">Tags</span>
          <TagInput tags={project.tags} onChange={(tags) => set({ tags })} />
        </div>
        <div className="meta-item">
          <span className="meta-label">Due</span>
          <input type="date" value={project.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </div>
        <div className="meta-item clickable" onClick={() => ui.navigate('time', id)} title="See time breakdown">
          <span className="meta-label">Time spent</span>
          <span className="meta-value">{fmtDuration(spent)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Status</span>
          <button className={cx('btn small', project.completed && 'active')} onClick={() => actions.toggleProjectComplete(id)}>
            {project.completed ? '✓ Completed' : 'Mark complete'}
          </button>
        </div>
      </div>

      <textarea className="notes-area" rows={2} value={project.notes} placeholder="Project notes, purpose, desired outcome…" onChange={(e) => set({ notes: e.target.value })} />

      {open.length > 0 && !moving && (
        <div className="hint-strip">This project has no next actions — nothing is moving. Add one, or right-click the project → Move to inbox.</div>
      )}

      <QuickEntry defaults={{ projectId: id }} placeholder={`Add a task to ${project.name}…`} hint={false} />
      <div className="list">
        {open.map((t) => <TaskRow key={t.id} task={t} showProject={false} draggable />)}
        {!open.length && <div className="empty small">No open tasks.</div>}
      </div>

      {done.length > 0 && (
        <section className="group">
          <h2 className="group-title muted clickable" onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} Completed {done.length}</h2>
          {showDone && <div className="list">{done.map((t) => <TaskRow key={t.id} task={t} showProject={false} />)}</div>}
        </section>
      )}
      <div className="muted small footnote">Created {fmtDay(project.createdAt.slice(0, 10))}{project.dueDate && project.dueDate < todayStr() && !project.completed ? ' · overdue' : ''}</div>
    </div>
  );
}
