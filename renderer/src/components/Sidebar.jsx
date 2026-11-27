import { useEffect, useState } from 'react';
import { useStore, runningLog, logDuration, useNow, allTags, taskProjectId, byOrder, childrenOf } from '../store';
import { dragProps, useTreeDrop } from './dnd';
import { useUI } from '../ui';
import { projectMenu, folderMenu } from '../menus';
import { todayStr, colorFor, fmtDuration, cx } from '../util';

function loadFilter() {
  try { return JSON.parse(localStorage.getItem('pp-project-filter')) || { mode: 'all' }; } catch { return { mode: 'all' }; }
}

function NavItem({ icon, label, count, active, onClick, onDropTask, className, style }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={cx('nav-item', active && 'active', over && 'drop-over', className)}
      style={style}
      onClick={onClick}
      onDragOver={onDropTask ? (e) => { if (e.dataTransfer.types.includes('application/x-task')) { e.preventDefault(); setOver(true); } } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={onDropTask ? (e) => { setOver(false); const id = e.dataTransfer.getData('application/x-task'); if (id) onDropTask(id); } : undefined}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {count > 0 && <span className="nav-count">{count}</span>}
    </div>
  );
}

function RunningTimer() {
  const { state, actions } = useStore();
  const ui = useUI();
  const now = useNow(1000);
  const log = runningLog(state);
  if (!log) return null;
  const task = state.tasks[log.taskId];
  return (
    <div className="running-timer" onClick={() => ui.openTask(log.taskId)}>
      <div className="running-label"><span className="pulse" /> Tracking</div>
      <div className="running-title">{task?.title || 'Deleted task'}</div>
      <div className="running-row">
        <span className="running-time">{fmtDuration(logDuration(log, now), { seconds: true })}</span>
        <button className="btn small" onClick={(e) => { e.stopPropagation(); actions.stopTimer(); }}>■ Stop</button>
      </div>
    </div>
  );
}

function FilterPopover({ filter, setFilter, onClose }) {
  const { state } = useStore();
  const tags = allTags(state);
  const folders = Object.values(state.folders);
  const renderFolders = (parentId, depth) =>
    folders.filter((f) => (f.parentId || null) === parentId).sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
      <div key={f.id}>
        <div className={cx('pop-item', filter.mode === 'folder' && filter.value === f.id && 'active')} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => { setFilter({ mode: 'folder', value: f.id }); onClose(); }}>
          📁 {f.name}
        </div>
        {renderFolders(f.id, depth + 1)}
      </div>
    ));

  useEffect(() => {
    const close = (e) => { if (!e.target.closest('.popover') && !e.target.closest('.filter-btn')) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);

  return (
    <div className="popover">
      <div className={cx('pop-item', filter.mode === 'all' && 'active')} onClick={() => { setFilter({ mode: 'all' }); onClose(); }}>All projects</div>
      <div className="pop-header">By folder</div>
      {folders.length ? renderFolders(null, 0) : <div className="pop-empty">No folders yet</div>}
      <div className="pop-header">By tag</div>
      {tags.length ? tags.map((t) => (
        <div key={t} className={cx('pop-item', filter.mode === 'tag' && filter.value === t && 'active')} onClick={() => { setFilter({ mode: 'tag', value: t }); onClose(); }}>#{t}</div>
      )) : <div className="pop-empty">No tags yet</div>}
    </div>
  );
}

function ProjectNavItem({ project, depth, count, dropClass }) {
  const store = useStore();
  const ui = useUI();
  return (
    <div
      {...dragProps('project', project.id)}
      className={cx('nav-item project-item', dropClass('project', project.id), ui.route.view === 'project' && ui.route.id === project.id && 'active')}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={() => ui.navigate('project', project.id)}
      onContextMenu={(e) => ui.openMenu(e, projectMenu(project, store, ui))}
    >
      <span className="nav-icon"><span className="dot" style={{ background: colorFor(project.id) }} /></span>
      <span className="nav-label">{project.name}</span>
      {count > 0 && <span className="nav-count">{count}</span>}
    </div>
  );
}

function FolderNavItem({ folder, depth, collapsed, onToggle, dropClass }) {
  const store = useStore();
  const ui = useUI();
  return (
    <div
      {...dragProps('folder', folder.id)}
      className={cx('nav-item folder-item', dropClass('folder', folder.id))}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={onToggle}
      onContextMenu={(e) => ui.openMenu(e, folderMenu(folder, store, ui))}
    >
      <span className="nav-icon small">{collapsed ? '▸' : '▾'}</span>
      <span className="nav-label">{folder.name}</span>
    </div>
  );
}

function ProjectTree() {
  const store = useStore();
  const { state, actions } = store;
  const ui = useUI();
  const [filter, setFilterState] = useState(loadFilter);
  const [showFilter, setShowFilter] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const rootFolder = filter.mode === 'folder' && state.folders[filter.value] ? filter.value : null;
  const dnd = useTreeDrop(rootFolder, {
    onTaskToProject: (taskId, projectId) => actions.updateTask(taskId, { projectId, parentId: null }),
  });

  const setFilter = (f) => {
    setFilterState(f);
    try { localStorage.setItem('pp-project-filter', JSON.stringify(f)); } catch {}
  };

  const openCounts = {};
  for (const t of Object.values(state.tasks)) {
    if (t.completed || t.parentId) continue;
    const pid = taskProjectId(state, t);
    if (pid) openCounts[pid] = (openCounts[pid] || 0) + 1;
  }

  const projects = Object.values(state.projects).filter((p) => !p.completed).sort(byOrder);
  const projectItem = (p, depth) => <ProjectNavItem key={p.id} project={p} depth={depth} count={openCounts[p.id]} dropClass={dnd.dropClass} />;

  const renderFolder = (folderId, depth) => childrenOf(state, folderId, (p) => !p.completed).map(({ kind, item }) =>
    kind === 'folder' ? (
      <div key={item.id}>
        <FolderNavItem folder={item} depth={depth} collapsed={collapsed[item.id]} dropClass={dnd.dropClass} onToggle={() => setCollapsed({ ...collapsed, [item.id]: !collapsed[item.id] })} />
        {!collapsed[item.id] && renderFolder(item.id, depth + 1)}
      </div>
    ) : projectItem(item, depth));

  let body;
  if (filter.mode === 'tag') {
    const list = projects.filter((p) => p.tags.includes(filter.value));
    body = list.length ? list.map((p) => projectItem(p, 0)) : <div className="nav-empty">No projects tagged #{filter.value}</div>;
  } else if (rootFolder) {
    const f = state.folders[rootFolder];
    body = (
      <>
        <div className="nav-item folder-item"><span className="nav-icon small">▾</span><span className="nav-label">{f.name}</span></div>
        {renderFolder(f.id, 1)}
        {childrenOf(state, f.id).length === 0 && <div className="nav-empty">Empty folder</div>}
      </>
    );
  } else {
    body = projects.length || Object.keys(state.folders).length ? renderFolder(null, 0) : <div className="nav-empty">No projects yet</div>;
  }

  const filterLabel = filter.mode === 'tag' ? '#' + filter.value : filter.mode === 'folder' ? state.folders[filter.value]?.name : null;

  return (
    <div className="nav-section">
      <div className="nav-section-head">
        <span className={cx('nav-section-title', ui.route.view === 'projects' && 'active')} onClick={() => ui.navigate('projects')}>Projects</span>
        {filterLabel && <span className="filter-label" onClick={() => setFilter({ mode: 'all' })} title="Clear filter">{filterLabel} ×</span>}
        <button className={cx('icon-btn filter-btn', filter.mode !== 'all' && 'active')} title="Filter projects" onClick={() => setShowFilter(!showFilter)}>⚲</button>
        <button
          className="icon-btn"
          title="New project"
          onClick={async () => {
            const name = await ui.prompt({ title: 'New project', placeholder: 'Project name' });
            if (name) ui.navigate('project', actions.addProject({ name, folderId: filter.mode === 'folder' ? filter.value : null }));
          }}
        >+</button>
        {showFilter && <FilterPopover filter={filter} setFilter={setFilter} onClose={() => setShowFilter(false)} />}
      </div>
      <div className={cx('project-tree', dnd.rootActive && 'drop-root')} {...dnd.containerProps}>{body}</div>
    </div>
  );
}

export default function Sidebar() {
  const { state, actions } = useStore();
  const ui = useUI();
  const today = todayStr();
  const inboxCount = Object.values(state.tasks).filter((t) => t.inbox).length + Object.values(state.projects).filter((p) => p.inbox).length;
  const todayCount = Object.values(state.tasks).filter((t) => !t.completed && (t.day === today || t.start.slice(0, 10) === today || (t.day && t.day < today))).length;
  const v = ui.route.view;

  return (
    <nav className="sidebar">
      <div className="nav-main">
        <NavItem icon="📥" label="Inbox" count={inboxCount} active={v === 'inbox'} onClick={() => ui.navigate('inbox')} onDropTask={(id) => actions.moveToInbox('task', id)} />
        <NavItem icon="☀" label="Today" count={todayCount} active={v === 'today'} onClick={() => ui.navigate('today')} onDropTask={(id) => actions.assignToday(id)} />
        <NavItem icon="☰" label="Task view" active={v === 'taskview' && !ui.route.id} onClick={() => ui.navigate('taskview')} />
        {state.savedViews.map((sv) => (
          <NavItem key={sv.id} className="sub-item" icon="·" label={sv.name} active={v === 'taskview' && ui.route.id === sv.id} onClick={() => ui.navigate('taskview', sv.id)} />
        ))}
        <NavItem icon="▦" label="Calendar" active={v === 'calendar'} onClick={() => ui.navigate('calendar')} />
        <NavItem icon="#" label="Tags" active={v === 'tags'} onClick={() => ui.navigate('tags')} />
        <NavItem icon="◔" label="Time tracking" active={v === 'time'} onClick={() => ui.navigate('time')} />
      </div>
      <ProjectTree />
      <div className="sidebar-foot">
        <RunningTimer />
        <div className="muted small b-alt-hint">Press <kbd>Alt</kbd> to switch to Budget</div>
        {state.paused ? (
          <button className="pause-btn paused" onClick={() => actions.resume()}>▶ Resume activity</button>
        ) : (
          <button className="pause-btn" onClick={() => actions.pause()} title="Stop all timers and notifications">❚❚ Pause activity</button>
        )}
      </div>
    </nav>
  );
}
