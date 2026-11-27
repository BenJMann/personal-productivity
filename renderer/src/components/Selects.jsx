import { useStore, folderPath } from '../store';
import { PRIORITIES, cx } from '../util';

export function ProjectSelect({ value, onChange, disabled, includeCompleted = false, emptyLabel = 'No project' }) {
  const { state } = useStore();
  const options = Object.values(state.projects)
    .filter((p) => includeCompleted || !p.completed || p.id === value)
    .map((p) => ({ p, label: [...folderPath(state, p.folderId).map((f) => f.name), p.name].join(' / ') }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <select value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {options.map(({ p, label }) => <option key={p.id} value={p.id}>{label}</option>)}
    </select>
  );
}

export function FolderSelect({ value, onChange, exclude, emptyLabel = 'Top level' }) {
  const { state } = useStore();
  const options = Object.values(state.folders)
    .filter((f) => !exclude || (f.id !== exclude && !folderPath(state, f.id).some((x) => x.id === exclude)))
    .map((f) => ({ f, label: folderPath(state, f.id).map((x) => x.name).join(' / ') }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {options.map(({ f, label }) => <option key={f.id} value={f.id}>{label}</option>)}
    </select>
  );
}

export function PrioritySelect({ value, onChange }) {
  return (
    <div className="segmented">
      {PRIORITIES.map((p) => (
        <button key={p.value} type="button" className={cx(value === p.value && 'active', 'prio-seg-' + p.value)} onClick={() => onChange(p.value)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
