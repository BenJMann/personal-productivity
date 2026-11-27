import { useState } from 'react';
import { useStore, allTags, folderPath, taskProjectId } from '../store';
import { useUI } from '../ui';
import { projectMenu } from '../menus';
import { OPS, NO_VALUE, GROUPS, SORTS, PRESETS, fieldsFor, newCondition, runQuery, groupItems } from '../query';
import TaskRow, { TagChips } from './TaskRow';
import { ProjectSelect, FolderSelect } from './Selects';
import { PRIORITIES, colorFor, fmtDay, cx } from '../util';

function ValueInput({ type, op, value, onChange }) {
  const { state } = useStore();
  if (NO_VALUE.has(op)) return null;
  switch (type) {
    case 'tags':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose tag…</option>
          {allTags(state).map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
      );
    case 'project':
      return <ProjectSelect value={value} onChange={(v) => onChange(v || '')} includeCompleted emptyLabel="Choose project…" />;
    case 'folder':
      return <FolderSelect value={value} onChange={(v) => onChange(v || '')} emptyLabel="Choose folder…" />;
    case 'priority':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      );
    case 'date':
      if (op === 'next_days') return <input type="number" min="0" className="narrow" value={value} placeholder="days" onChange={(e) => onChange(e.target.value)} />;
      return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" className="narrow" value={value} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input value={value} placeholder="text" onChange={(e) => onChange(e.target.value)} />;
  }
}

export function QueryBuilder({ query, setQuery }) {
  const fields = fieldsFor(query.entity);
  const set = (patch) => setQuery({ ...query, ...patch });
  const setCond = (id, patch) => set({ conditions: query.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  return (
    <div className="query-builder">
      <div className="qb-row">
        <span className="qb-label">Show</span>
        <div className="segmented">
          {['tasks', 'projects'].map((e) => (
            <button key={e} className={cx(query.entity === e && 'active')} onClick={() => set({ entity: e, conditions: [], groupBy: GROUPS[e][0][0], sortBy: SORTS[e][0][0] })}>
              {e === 'tasks' ? 'Tasks' : 'Projects'}
            </button>
          ))}
        </div>
        <span className="qb-label">matching</span>
        <select value={query.match} onChange={(e) => set({ match: e.target.value })}>
          <option value="all">all conditions</option>
          <option value="any">any condition</option>
        </select>
        <span className="qb-label">group by</span>
        <select value={query.groupBy} onChange={(e) => set({ groupBy: e.target.value })}>
          {GROUPS[query.entity].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="qb-label">sort by</span>
        <select value={query.sortBy} onChange={(e) => set({ sortBy: e.target.value })}>
          {SORTS[query.entity].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {query.conditions.map((c) => {
        const f = fields[c.field] || Object.values(fields)[0];
        return (
          <div key={c.id} className="qb-row cond">
            <select value={c.field} onChange={(e) => {
              const nf = fields[e.target.value];
              const op = OPS[nf.type][0][0];
              setCond(c.id, { field: e.target.value, op, value: nf.type === 'priority' ? '3' : '' });
            }}>
              {Object.entries(fields).map(([k, fd]) => <option key={k} value={k}>{fd.label}</option>)}
            </select>
            <select value={c.op} onChange={(e) => setCond(c.id, { op: e.target.value })}>
              {OPS[f.type].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <ValueInput type={f.type} op={c.op} value={c.value} onChange={(v) => setCond(c.id, { value: v })} />
            <button className="icon-btn" title="Remove condition" onClick={() => set({ conditions: query.conditions.filter((x) => x.id !== c.id) })}>✕</button>
          </div>
        );
      })}

      <div className="qb-row">
        <button className="btn ghost small" onClick={() => set({ conditions: [...query.conditions, newCondition(query.entity)] })}>+ Add condition</button>
        <label className="toggle"><input type="checkbox" checked={query.showCompleted} onChange={(e) => set({ showCompleted: e.target.checked })} /> Include completed</label>
        {query.entity === 'tasks' && (
          <label className="toggle"><input type="checkbox" checked={query.includeSubtasks} onChange={(e) => set({ includeSubtasks: e.target.checked })} /> Match subtasks individually</label>
        )}
      </div>
    </div>
  );
}

function ProjectResultRow({ project }) {
  const store = useStore();
  const { state } = store;
  const ui = useUI();
  const open = Object.values(state.tasks).filter((t) => !t.completed && !t.parentId && taskProjectId(state, t) === project.id);
  const withNext = open.filter((t) => t.nextAction).length;
  return (
    <div className={cx('task-row', project.completed && 'completed')} onClick={() => ui.navigate('project', project.id)} onContextMenu={(e) => ui.openMenu(e, projectMenu(project, store, ui))}>
      <span className="dot" style={{ background: colorFor(project.id) }} />
      <div className="task-main">
        <div className="task-title">{project.name}</div>
        {project.folderId && <div className="muted small">{folderPath(state, project.folderId).map((f) => f.name).join(' / ')}</div>}
      </div>
      <div className="task-meta">
        <TagChips tags={project.tags} />
        {project.dueDate && <span className="chip">⚑ {fmtDay(project.dueDate)}</span>}
        <span className="chip">{open.length} open · {withNext} with next actions</span>
      </div>
    </div>
  );
}

export default function TaskViewer({ query, setQuery, compact = false, draggable = false }) {
  const { state } = useStore();
  const ui = useUI();
  const [showBuilder, setShowBuilder] = useState(!compact);
  const items = runQuery(state, query);
  const groups = groupItems(state, items, query);

  return (
    <div className={cx('task-viewer', compact && 'compact')}>
      <div className="tv-toolbar">
        <input className="search" placeholder="Search…" value={query.search} onChange={(e) => setQuery({ ...query, search: e.target.value })} />
        <select
          value=""
          onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) setQuery({ ...structuredClone(p.query), search: query.search }); }}
        >
          <option value="">Presets…</option>
          {PRESETS.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
        </select>
        <button className={cx('btn small', showBuilder && 'active')} onClick={() => setShowBuilder(!showBuilder)}>
          ⚲ Filters{query.conditions.length ? ` (${query.conditions.length})` : ''}
        </button>
        <span className="muted small">{items.length} {query.entity}</span>
      </div>
      {showBuilder && <QueryBuilder query={query} setQuery={setQuery} />}

      <div className="tv-results">
        {items.length === 0 && <div className="empty small">Nothing matches.</div>}
        {groups.map((g) => (
          <section key={g.key} className="group">
            {g.label && (
              <h2 className={cx('group-title', g.projectId && 'clickable')} onClick={g.projectId ? () => ui.navigate('project', g.projectId) : undefined}>
                {g.projectId && <span className="dot" style={{ background: colorFor(g.projectId) }} />}
                {g.date ? fmtDay(g.date) : g.label} <span className="muted">{g.items.length}</span>
              </h2>
            )}
            <div className="list">
              {g.items.map((item) =>
                query.entity === 'projects'
                  ? <ProjectResultRow key={item.id} project={item} />
                  : <TaskRow key={item.id} task={item} showProject={query.groupBy !== 'project'} draggable={draggable} />,
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
