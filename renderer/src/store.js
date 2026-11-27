import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { produce } from 'immer';
import { uid, todayStr, dateTimeStr } from './util';
import { emptyBudget } from './budget/model';
import { makeBudgetActions } from './budget/actions';

const emptyState = () => ({
  version: 1,
  tasks: {},
  projects: {},
  folders: {},
  timeLogs: [], // { id, taskId, projectId, start, end } — end null while running
  savedViews: [],
  paused: false,
  pausedAt: null,
  notified: {}, // taskId -> start string we already notified for
  alerts: [], // taskIds that became ready to start (shown in the banner)
  missed: [], // taskIds whose start passed while paused
  budget: emptyBudget(),
});

const backend = {
  async load() {
    if (window.api) return window.api.load();
    try { return JSON.parse(localStorage.getItem('pp-data')); } catch { return null; }
  },
  save(data) {
    if (window.api) return window.api.save(data);
    try { localStorage.setItem('pp-data', JSON.stringify(data)); } catch {}
  },
};

export function newTask(fields = {}) {
  return {
    id: uid(),
    kind: 'task',
    title: '',
    notes: '',
    projectId: null,
    parentId: null,
    nextAction: '',
    nextActionHistory: [],
    tags: [],
    start: '', // scheduled start time (shows on calendar)
    day: '', // day assigned to do it on
    dueDate: '',
    estimate: null, // minutes
    priority: 0,
    completed: false,
    completedAt: null,
    inbox: false,
    createdAt: new Date().toISOString(),
    order: Date.now(),
    ...fields,
  };
}

export function newProject(fields = {}) {
  return {
    id: uid(),
    kind: 'project',
    name: '',
    notes: '',
    folderId: null,
    tags: [],
    dueDate: '',
    completed: false,
    completedAt: null,
    inbox: false,
    createdAt: new Date().toISOString(),
    order: Date.now(),
    ...fields,
  };
}

// ---- Derived helpers (pure; take state) ----

export function rootTask(state, task) {
  let t = task;
  while (t && t.parentId && state.tasks[t.parentId]) t = state.tasks[t.parentId];
  return t;
}

// A subtask belongs to the project of its top-level parent task.
export function taskProjectId(state, task) {
  return rootTask(state, task)?.projectId || null;
}

export function subtasksOf(state, id) {
  return Object.values(state.tasks).filter((t) => t.parentId === id).sort((a, b) => a.order - b.order);
}

export function descendantIds(state, id) {
  const out = [];
  const walk = (pid) => {
    for (const t of Object.values(state.tasks)) {
      if (t.parentId === pid) { out.push(t.id); walk(t.id); }
    }
  };
  walk(id);
  return out;
}

export function folderPath(state, folderId) {
  const parts = [];
  let f = state.folders[folderId];
  while (f) { parts.unshift(f); f = state.folders[f.parentId]; }
  return parts;
}

export function folderDescendants(state, folderId) {
  const out = [folderId];
  for (let i = 0; i < out.length; i++) {
    for (const f of Object.values(state.folders)) if (f.parentId === out[i]) out.push(f.id);
  }
  return out;
}

export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

// Folders and projects directly inside `parentId`, in their shared order: [{ kind, item }].
export function childrenOf(state, parentId, projectFilter = () => true) {
  const pid = parentId || null;
  return [
    ...Object.values(state.folders).filter((f) => (f.parentId || null) === pid).map((f) => ({ kind: 'folder', item: f })),
    ...Object.values(state.projects).filter((p) => (p.folderId || null) === pid && projectFilter(p)).map((p) => ({ kind: 'project', item: p })),
  ].sort((a, b) => byOrder(a.item, b.item));
}

export function allTags(state) {
  const set = new Set();
  for (const t of Object.values(state.tasks)) t.tags.forEach((x) => set.add(x));
  for (const p of Object.values(state.projects)) p.tags.forEach((x) => set.add(x));
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function runningLog(state) {
  return state.timeLogs.find((l) => !l.end) || null;
}

export function logDuration(log, now = Date.now()) {
  return (log.end ? new Date(log.end) : new Date(now)) - new Date(log.start);
}

export function timeForTask(state, taskId, now) {
  const ids = new Set([taskId, ...descendantIds(state, taskId)]);
  return state.timeLogs.filter((l) => ids.has(l.taskId)).reduce((s, l) => s + logDuration(l, now), 0);
}

export function timeForProject(state, projectId, now) {
  return state.timeLogs.filter((l) => l.projectId === projectId).reduce((s, l) => s + logDuration(l, now), 0);
}

export function projectHasNextActions(state, projectId) {
  return Object.values(state.tasks).some(
    (t) => !t.completed && t.nextAction && taskProjectId(state, t) === projectId,
  );
}

// ---- Actions ----

function makeActions(update) {
  const stopRunning = (s) => {
    const now = new Date().toISOString();
    s.timeLogs.forEach((l) => { if (!l.end) l.end = now; });
  };

  const actions = {
    ...makeBudgetActions(update),
    addTask(fields) {
      const t = newTask(fields);
      update((s) => { s.tasks[t.id] = t; });
      return t.id;
    },
    updateTask(id, patch) {
      update((s) => { if (s.tasks[id]) Object.assign(s.tasks[id], patch); });
    },
    deleteTask(id) {
      update((s) => {
        const ids = [id, ...descendantIds(s, id)];
        ids.forEach((x) => delete s.tasks[x]);
        s.alerts = s.alerts.filter((x) => !ids.includes(x));
        s.timeLogs.forEach((l) => { if (ids.includes(l.taskId) && !l.end) l.end = new Date().toISOString(); });
      });
    },
    toggleComplete(id) {
      update((s) => {
        const t = s.tasks[id];
        if (!t) return;
        t.completed = !t.completed;
        t.completedAt = t.completed ? new Date().toISOString() : null;
        if (t.completed) {
          t.inbox = false;
          s.alerts = s.alerts.filter((x) => x !== id);
          const running = s.timeLogs.find((l) => !l.end && l.taskId === id);
          if (running) running.end = new Date().toISOString();
        }
      });
    },
    // Records the current next action as done and replaces it with a new one.
    completeNextAction(id, next = '') {
      update((s) => {
        const t = s.tasks[id];
        if (!t) return;
        if (t.nextAction) t.nextActionHistory.push({ text: t.nextAction, doneAt: new Date().toISOString() });
        t.nextAction = next;
      });
    },
    addProject(fields) {
      const p = newProject(fields);
      update((s) => { s.projects[p.id] = p; });
      return p.id;
    },
    updateProject(id, patch) {
      update((s) => { if (s.projects[id]) Object.assign(s.projects[id], patch); });
    },
    deleteProject(id, { deleteTasks = false } = {}) {
      update((s) => {
        for (const t of Object.values(s.tasks)) {
          if (t.projectId !== id) continue;
          if (deleteTasks) {
            [t.id, ...descendantIds(s, t.id)].forEach((x) => delete s.tasks[x]);
          } else {
            t.projectId = null;
            t.inbox = true; // orphaned tasks need re-processing
          }
        }
        delete s.projects[id];
      });
    },
    toggleProjectComplete(id) {
      update((s) => {
        const p = s.projects[id];
        p.completed = !p.completed;
        p.completedAt = p.completed ? new Date().toISOString() : null;
        if (p.completed) p.inbox = false;
      });
    },
    convertTaskToProject(id, name) {
      let pid = null;
      update((s) => {
        const t = s.tasks[id];
        if (!t) return;
        const p = newProject({ name: name || t.title, notes: t.notes, tags: [...t.tags], dueDate: t.dueDate, inbox: t.inbox, folderId: t.projectId ? s.projects[t.projectId]?.folderId || null : null });
        pid = p.id;
        s.projects[p.id] = p;
        // Subtasks become the project's tasks; the next action becomes a task of its own.
        for (const sub of Object.values(s.tasks)) {
          if (sub.parentId === id) { sub.parentId = null; sub.projectId = p.id; }
        }
        if (t.nextAction) {
          const na = newTask({ title: t.nextAction, projectId: p.id, nextAction: '' });
          s.tasks[na.id] = na;
        }
        s.timeLogs.forEach((l) => { if (l.taskId === id) l.projectId = p.id; });
        delete s.tasks[id];
      });
      return pid;
    },
    // Creates a project with its own name and moves the task into it.
    moveTaskToNewProject(id, name) {
      const p = newProject({ name });
      update((s) => {
        const t = s.tasks[id];
        if (!t) return;
        p.folderId = s.projects[t.projectId]?.folderId || null;
        s.projects[p.id] = p;
        t.projectId = p.id;
        t.parentId = null;
      });
      return p.id;
    },
    // Moves a folder or project within the tree. Folders and projects that share a parent
    // share one ordering, used by both the sidebar and the Projects screen.
    // target: { kind: 'root', id: parentFolderId } (end of that folder)
    //       | { kind: 'folder', id, pos: 'into' } (end of that folder)
    //       | { kind: 'folder' | 'project', id, pos: 'before' | 'after' }
    moveNode(kind, id, target) {
      update((s) => {
        const node = kind === 'folder' ? s.folders[id] : s.projects[id];
        if (!node || (target.kind === kind && target.id === id)) return;
        let parent;
        let anchor = null;
        if (target.kind === 'root') parent = target.id || null;
        else if (target.pos === 'into') parent = target.id;
        else {
          const t = target.kind === 'folder' ? s.folders[target.id] : s.projects[target.id];
          if (!t) return;
          parent = (target.kind === 'folder' ? t.parentId : t.folderId) || null;
          anchor = target;
        }
        if (kind === 'folder' && parent && folderDescendants(s, id).includes(parent)) return;
        if (kind === 'folder') node.parentId = parent;
        else node.folderId = parent;
        const sibs = childrenOf(s, parent).filter((c) => !(c.kind === kind && c.item.id === id));
        let idx = sibs.length;
        if (anchor) {
          const i = sibs.findIndex((c) => c.kind === anchor.kind && c.item.id === anchor.id);
          if (i >= 0) idx = i + (anchor.pos === 'after' ? 1 : 0);
        }
        sibs.splice(idx, 0, { kind, item: node });
        sibs.forEach((c, i) => { c.item.order = i; });
      });
    },
    moveProject(id, { folderId }) {
      actions.moveNode('project', id, { kind: 'root', id: folderId || null });
    },
    moveToInbox(kind, id) {
      update((s) => {
        const coll = kind === 'project' ? s.projects : s.tasks;
        if (coll[id]) { coll[id].inbox = true; coll[id].completed = false; }
      });
    },
    processComplete(kind, id) {
      update((s) => {
        const coll = kind === 'project' ? s.projects : s.tasks;
        if (coll[id]) coll[id].inbox = false;
      });
    },
    addFolder(fields) {
      const f = { id: uid(), name: 'New folder', parentId: null, order: Date.now(), ...fields };
      update((s) => { s.folders[f.id] = f; });
      return f.id;
    },
    updateFolder(id, patch) {
      update((s) => { Object.assign(s.folders[id], patch); });
    },
    deleteFolder(id) {
      // Contents move up to the parent folder.
      update((s) => {
        const parent = s.folders[id]?.parentId || null;
        Object.values(s.folders).forEach((f) => { if (f.parentId === id) f.parentId = parent; });
        Object.values(s.projects).forEach((p) => { if (p.folderId === id) p.folderId = parent; });
        delete s.folders[id];
      });
    },
    renameTag(from, to) {
      update((s) => {
        for (const item of [...Object.values(s.tasks), ...Object.values(s.projects)]) {
          if (item.tags.includes(from)) item.tags = [...new Set(item.tags.map((t) => (t === from ? to : t)).filter(Boolean))];
        }
      });
    },
    startTimer(taskId) {
      update((s) => {
        if (s.paused) { s.paused = false; s.pausedAt = null; }
        stopRunning(s);
        const t = s.tasks[taskId];
        if (!t) return;
        s.timeLogs.push({ id: uid(), taskId, projectId: taskProjectId(s, t), start: new Date().toISOString(), end: null });
        s.alerts = s.alerts.filter((x) => x !== taskId);
      });
    },
    stopTimer() {
      update(stopRunning);
    },
    deleteLog(id) {
      update((s) => { s.timeLogs = s.timeLogs.filter((l) => l.id !== id); });
    },
    pause() {
      update((s) => {
        stopRunning(s);
        s.paused = true;
        s.pausedAt = new Date().toISOString();
        s.alerts = [];
      });
    },
    // Coming back: anything whose start passed while away is collected quietly instead of firing alerts.
    resume() {
      update((s) => {
        const now = dateTimeStr(new Date());
        const missed = [];
        for (const t of Object.values(s.tasks)) {
          if (!t.completed && t.start && t.start <= now && s.notified[t.id] !== t.start) {
            s.notified[t.id] = t.start;
            missed.push(t.id);
          }
        }
        s.missed = [...new Set([...s.missed, ...missed])];
        s.paused = false;
        s.pausedAt = null;
      });
    },
    markNotified(ids) {
      update((s) => {
        for (const id of ids) {
          const t = s.tasks[id];
          if (!t) continue;
          s.notified[id] = t.start;
          if (!s.alerts.includes(id)) s.alerts.push(id);
        }
      });
    },
    dismissAlert(id) {
      update((s) => { s.alerts = s.alerts.filter((x) => x !== id); });
    },
    clearMissed({ toInbox = false } = {}) {
      update((s) => {
        if (toInbox) s.missed.forEach((id) => { if (s.tasks[id]) s.tasks[id].inbox = true; });
        s.missed = [];
      });
    },
    saveView(name, query, id) {
      const vid = id || uid();
      update((s) => {
        const existing = s.savedViews.find((v) => v.id === vid);
        if (existing) Object.assign(existing, { name, query });
        else s.savedViews.push({ id: vid, name, query });
      });
      return vid;
    },
    deleteView(id) {
      update((s) => { s.savedViews = s.savedViews.filter((v) => v.id !== id); });
    },
    assignToday(id) {
      update((s) => { if (s.tasks[id]) s.tasks[id].day = todayStr(); });
    },
  };
  return actions;
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, setState] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    backend.load().then((data) => {
      const s = { ...emptyState(), ...(data || {}) };
      s.budget = { ...emptyBudget(), ...s.budget, settings: { ...emptyBudget().settings, ...s.budget.settings } };
      setState(s);
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => backend.save(state), 250);
  }, [state]);

  // Flush pending writes when the window closes.
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const flush = () => { if (latest.current) backend.save(latest.current); };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const actions = useMemo(() => makeActions((fn) => setState((s) => produce(s, fn))), []);
  const value = useMemo(() => ({ state, actions }), [state, actions]);

  if (!state) return null;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);

// Ticks every `ms` so running timers re-render.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
