// Drag-and-drop for the folder/project tree, shared by the sidebar and the Projects screen.
//
// One controller per list works out the drop target from the pointer position, so the
// indicator only changes when the target really changes (no flicker when the pointer
// crosses a row's child elements).
import { useRef, useState } from 'react';
import { useStore, folderDescendants } from '../store';

const TASK = 'application/x-task';
let dragging = null; // { kind: 'folder' | 'project', id } — set on dragstart, same window only

// Spread onto a folder or project row to make it draggable and identifiable as a drop target.
export function dragProps(kind, id) {
  return {
    draggable: true,
    'data-dnd-kind': kind,
    'data-dnd-id': id,
    onDragStart: (e) => {
      e.stopPropagation();
      dragging = { kind, id };
      e.dataTransfer.setData('application/x-' + kind, id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => { dragging = null; },
  };
}

// rootFolderId: the folder this list shows (null = top level); dropping on empty space puts items at its end.
// onTaskToProject(taskId, projectId): called when a task is dropped onto a project row.
export function useTreeDrop(rootFolderId = null, { onTaskToProject } = {}) {
  const { state, actions } = useStore();
  const [target, setTarget] = useState(null);
  const current = useRef(null);

  const set = (t) => {
    const key = (x) => (x ? `${x.kind}:${x.id}:${x.pos}` : '');
    if (key(t) !== key(current.current)) {
      current.current = t;
      setTarget(t);
    }
  };

  const compute = (e) => {
    const isTask = e.dataTransfer.types.includes(TASK);
    if (!isTask && !dragging) return null;
    const el = e.target.closest?.('[data-dnd-id]');
    if (!el || !e.currentTarget.contains(el)) return isTask ? null : { kind: 'root', id: rootFolderId, pos: 'end' };
    const kind = el.dataset.dndKind;
    const id = el.dataset.dndId;
    if (isTask) return kind === 'project' ? { kind, id, pos: 'into' } : null;
    if (dragging.kind === kind && dragging.id === id) return null;

    const r = el.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const pos = kind === 'folder' ? (y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'into') : (y < 0.5 ? 'before' : 'after');

    // A folder can't be moved inside itself.
    if (dragging.kind === 'folder') {
      const parent = pos === 'into' ? id : (kind === 'folder' ? state.folders[id]?.parentId : state.projects[id]?.folderId) || null;
      if (parent && folderDescendants(state, dragging.id).includes(parent)) return null;
    }
    return { kind, id, pos };
  };

  const containerProps = {
    onDragOver: (e) => {
      const t = compute(e);
      if (t) {
        e.preventDefault();
        e.stopPropagation();
      }
      set(t);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) set(null);
    },
    onDrop: (e) => {
      const t = current.current; // drop exactly where the indicator was showing
      set(null);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const taskId = e.dataTransfer.getData(TASK);
      if (taskId) onTaskToProject?.(taskId, t.id);
      else if (dragging) actions.moveNode(dragging.kind, dragging.id, t);
      dragging = null;
    },
  };

  const dropClass = (kind, id) => (target && target.kind === kind && target.id === id ? 'drop-' + target.pos : '');
  return { containerProps, dropClass, rootActive: target?.kind === 'root' };
}
