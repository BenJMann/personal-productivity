import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useUI } from '../ui';
import TaskViewer from '../components/TaskViewer';
import { defaultQuery } from '../query';

export default function TaskView({ viewId }) {
  const { state, actions } = useStore();
  const ui = useUI();
  const saved = state.savedViews.find((v) => v.id === viewId);
  const [query, setQuery] = useState(() => (saved ? structuredClone(saved.query) : defaultQuery()));

  useEffect(() => {
    setQuery(saved ? structuredClone(saved.query) : defaultQuery());
  }, [viewId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = saved && JSON.stringify(saved.query) !== JSON.stringify(query);

  return (
    <div className="view">
      <header className="view-head">
        <h1>{saved ? saved.name : 'Task view'}</h1>
        <div className="spacer" />
        {saved && dirty && <button className="btn" onClick={() => actions.saveView(saved.name, query, saved.id)}>Update view</button>}
        {saved && dirty && <button className="btn ghost" onClick={() => setQuery(structuredClone(saved.query))}>Revert</button>}
        <button
          className="btn"
          onClick={async () => {
            const name = await ui.prompt({ title: 'Save view', label: 'It will appear in the sidebar under Task view', placeholder: 'View name', value: saved ? saved.name + ' copy' : '' });
            if (name) ui.navigate('taskview', actions.saveView(name, query));
          }}
        >
          Save as view…
        </button>
        {saved && (
          <button
            className="btn ghost danger-text"
            onClick={async () => {
              if (await ui.confirm({ title: 'Delete view?', message: `"${saved.name}" will be removed from the sidebar.`, okLabel: 'Delete', danger: true })) {
                actions.deleteView(saved.id);
                ui.navigate('taskview');
              }
            }}
          >
            Delete view
          </button>
        )}
      </header>
      <TaskViewer query={query} setQuery={setQuery} />
    </div>
  );
}
