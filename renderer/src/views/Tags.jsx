import { useStore, allTags, taskProjectId } from '../store';
import { useUI } from '../ui';
import { projectMenu } from '../menus';
import TaskRow, { TagChips } from '../components/TaskRow';
import { colorFor, cx } from '../util';

export default function Tags({ tag }) {
  const store = useStore();
  const { state, actions } = store;
  const ui = useUI();
  const tags = allTags(state);
  const count = (t) => Object.values(state.tasks).filter((x) => !x.completed && x.tags.includes(t)).length + Object.values(state.projects).filter((p) => !p.completed && p.tags.includes(t)).length;

  const selected = tag && tags.includes(tag) ? tag : null;
  const projects = selected ? Object.values(state.projects).filter((p) => p.tags.includes(selected) && !p.completed).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const tasks = selected ? Object.values(state.tasks).filter((t) => t.tags.includes(selected) && !t.completed) : [];

  const tagMenu = (t) => [
    {
      label: 'Rename tag…',
      onClick: async () => {
        const v = await ui.prompt({ title: 'Rename tag', value: t });
        if (v) { actions.renameTag(t, v.replace(/^#/, '')); if (selected === t) ui.navigate('tags', v.replace(/^#/, '')); }
      },
    },
    {
      label: 'Remove tag from everything',
      danger: true,
      onClick: async () => {
        if (await ui.confirm({ title: `Remove #${t}?`, message: 'The tag is removed from all tasks and projects. The items themselves are kept.', okLabel: 'Remove', danger: true })) actions.renameTag(t, '');
      },
    },
  ];

  return (
    <div className="view">
      <header className="view-head"><h1>Tags</h1></header>
      <div className="tag-cloud">
        {tags.length === 0 && <div className="muted">No tags yet. Type <code>#tag</code> when capturing, or add tags in any task or project.</div>}
        {tags.map((t) => (
          <button key={t} className={cx('tag-pill', selected === t && 'active')} onClick={() => ui.navigate('tags', t)} onContextMenu={(e) => ui.openMenu(e, tagMenu(t))}>
            #{t} <span className="muted">{count(t)}</span>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <section className="group">
            <h2 className="group-title">Projects <span className="muted">{projects.length}</span></h2>
            {projects.length ? (
              <div className="list">
                {projects.map((p) => (
                  <div key={p.id} className="task-row" onClick={() => ui.navigate('project', p.id)} onContextMenu={(e) => ui.openMenu(e, projectMenu(p, store, ui))}>
                    <span className="dot" style={{ background: colorFor(p.id) }} />
                    <div className="task-main"><div className="task-title">{p.name}</div></div>
                    <div className="task-meta">
                      <TagChips tags={p.tags} onClick={(t) => ui.navigate('tags', t)} />
                      <span className="chip">{Object.values(state.tasks).filter((t) => !t.completed && !t.parentId && taskProjectId(state, t) === p.id).length} open</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="empty small">No projects tagged #{selected}</div>}
          </section>
          <section className="group">
            <h2 className="group-title">Tasks <span className="muted">{tasks.length}</span></h2>
            {tasks.length ? <div className="list">{tasks.map((t) => <TaskRow key={t.id} task={t} showSubtasks={false} />)}</div> : <div className="empty small">No tasks tagged #{selected}</div>}
          </section>
        </>
      )}
      {!selected && tags.length > 0 && <div className="empty small">Pick a tag to see its projects and tasks.</div>}
    </div>
  );
}
