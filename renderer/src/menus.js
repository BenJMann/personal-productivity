// Right-click menus for tasks, projects and folders, shared by every screen.
// Items marked `more: true` sit behind the menu's "More options" toggle.
import { runningLog, folderPath, allTags } from './store';
import { todayStr, addDays, fmtDay, fmtDateTime, fmtMinutes, PRIORITIES } from './util';

const SEP = { separator: true };
const truncate = (s, n = 22) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

function projectLabel(state, p) {
  return [...folderPath(state, p.folderId).map((f) => f.name), p.name].join(' / ');
}

function projectSubmenu(state, ui, current, onPick, { allowNew = true } = {}) {
  const projects = Object.values(state.projects)
    .filter((p) => !p.completed)
    .sort((a, b) => projectLabel(state, a).localeCompare(projectLabel(state, b)));
  return [
    allowNew && {
      icon: 'plus',
      label: 'New project…',
      onClick: async () => {
        const name = await ui.prompt({ title: 'New project', label: 'The task will be moved into it', placeholder: 'Project name' });
        if (name) onPick(null, name);
      },
    },
    allowNew && SEP,
    { label: 'No project', checked: !current, onClick: () => onPick(null) },
    ...projects.map((p) => ({ label: projectLabel(state, p), checked: current === p.id, onClick: () => onPick(p.id) })),
  ];
}

function folderSubmenu(state, ui, current, onPick, exclude) {
  const folders = Object.values(state.folders)
    .filter((f) => !exclude || (f.id !== exclude && !folderPath(state, f.id).some((x) => x.id === exclude)))
    .map((f) => ({ f, path: folderPath(state, f.id).map((x) => x.name).join(' / ') }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return [
    {
      icon: 'folderPlus',
      label: 'New folder…',
      onClick: async () => {
        const name = await ui.prompt({ title: 'New folder', placeholder: 'Folder name' });
        if (name) onPick(null, name);
      },
    },
    SEP,
    { label: 'Top level', checked: !current, onClick: () => onPick(null) },
    ...folders.map(({ f, path }) => ({ label: path, checked: current === f.id, onClick: () => onPick(f.id) })),
  ];
}

// Toggle existing tags on/off, or create a new one.
function tagsSubmenu(state, ui, tags, setTags, name) {
  const known = allTags(state);
  return [
    {
      icon: 'plus',
      label: 'New tag…',
      onClick: async () => {
        const v = await ui.prompt({ title: 'Add tags', label: name, placeholder: 'one or more, separated by spaces' });
        if (v) setTags([...new Set([...tags, ...v.split(/[,\s]+/).map((x) => x.replace(/^#/, '')).filter(Boolean)])]);
      },
    },
    known.length > 0 && SEP,
    ...known.map((t) => ({
      label: '#' + t,
      checked: tags.includes(t),
      onClick: () => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]),
    })),
    tags.length > 0 && SEP,
    tags.length > 0 && { icon: 'x', label: 'Remove all tags', onClick: () => setTags([]) },
  ];
}

function dateSubmenu(ui, value, title, onSet) {
  const today = todayStr();
  return [
    { icon: 'sun', label: 'Today', checked: value === today, onClick: () => onSet(today) },
    { icon: 'arrowRight', label: 'Tomorrow', checked: value === addDays(today, 1), onClick: () => onSet(addDays(today, 1)) },
    { icon: 'calendar', label: 'In a week', checked: value === addDays(today, 7), onClick: () => onSet(addDays(today, 7)) },
    SEP,
    {
      icon: 'calendar',
      label: 'Pick a date…',
      onClick: async () => {
        const v = await ui.pickDate({ title, value });
        if (v !== null) onSet(v);
      },
    },
    value && { icon: 'x', label: 'Clear', onClick: () => onSet('') },
  ];
}

export function taskMenu(task, { state, actions }, ui, { inInboxView = false } = {}) {
  const running = runningLog(state);
  const isRunning = running?.taskId === task.id;
  const set = (patch) => actions.updateTask(task.id, patch);
  const project = state.projects[task.projectId];

  const editNextAction = async () => {
    const v = await ui.prompt({ title: 'Next action', label: task.title, value: task.nextAction, placeholder: 'The very next physical step' });
    if (v !== null) set({ nextAction: v });
  };
  const pickStart = async () => {
    const v = await ui.pickDate({ title: 'Start time', value: task.start, withTime: true });
    if (v !== null) set({ start: v, day: v ? v.slice(0, 10) : task.day });
  };
  const pickEstimate = async () => {
    const v = await ui.pickDuration({ title: 'Estimate', value: task.estimate });
    if (v !== null) set({ estimate: v || null });
  };

  return [
    { icon: 'open', label: 'Open details', onClick: () => ui.openTask(task.id) },
    isRunning
      ? { icon: 'stop', label: 'Stop timer', onClick: () => actions.stopTimer() }
      : { icon: 'play', label: 'Start timer', onClick: () => actions.startTimer(task.id), disabled: task.completed },
    SEP,
    task.inbox
      ? { icon: 'checkCircle', label: 'Processing complete', onClick: () => actions.processComplete('task', task.id) }
      : { icon: 'inbox', label: 'Move to inbox', onClick: () => actions.moveToInbox('task', task.id) },
    !inInboxView && {
      icon: task.completed ? 'undo' : 'check',
      label: task.completed ? 'Mark incomplete' : 'Mark complete',
      onClick: () => actions.toggleComplete(task.id),
    },
    { icon: 'arrowRight', label: task.nextAction ? 'Change next action…' : 'Add next action…', hint: truncate(task.nextAction), onClick: editNextAction },
    SEP,
    { icon: 'sun', label: 'Do on day', hint: fmtDay(task.day), submenu: dateSubmenu(ui, task.day, 'Do on day', (v) => set({ day: v })) },
    { icon: 'clock', label: task.start ? 'Start time…' : 'Set start time…', hint: task.start ? fmtDateTime(task.start) : '', onClick: pickStart },
    { icon: 'flag', label: 'Due date', hint: fmtDay(task.dueDate), submenu: dateSubmenu(ui, task.dueDate, 'Due date', (v) => set({ dueDate: v })) },
    SEP,
    task.parentId
      ? { icon: 'layers', label: 'Move to project', hint: 'from parent', disabled: true }
      : {
        icon: 'layers',
        label: 'Move to project',
        hint: truncate(project?.name, 18),
        submenu: projectSubmenu(state, ui, task.projectId, (pid, newName) => {
          if (newName) actions.moveTaskToNewProject(task.id, newName);
          else set({ projectId: pid });
        }),
      },
    {
      icon: 'bars',
      label: 'Priority',
      hint: task.priority ? PRIORITIES[task.priority].label : '',
      submenu: PRIORITIES.map((p) => ({ label: p.label, checked: task.priority === p.value, onClick: () => set({ priority: p.value }) })),
    },
    {
      icon: 'timer',
      label: 'Estimate',
      hint: fmtMinutes(task.estimate),
      submenu: [
        ...[15, 30, 60, 120, 240].map((m) => ({ label: fmtMinutes(m), checked: task.estimate === m, onClick: () => set({ estimate: m }) })),
        SEP,
        { icon: 'edit', label: 'Custom…', onClick: pickEstimate },
        task.estimate && { icon: 'x', label: 'Clear', onClick: () => set({ estimate: null }) },
      ],
    },
    { icon: 'tag', label: 'Tags', hint: task.tags.length ? String(task.tags.length) : '', submenu: tagsSubmenu(state, ui, task.tags, (tags) => set({ tags }), task.title) },

    // Less frequently used — behind "More options".
    task.nextAction && { more: true, icon: 'x', label: 'Clear next action', onClick: () => set({ nextAction: '' }) },
    task.start && { more: true, icon: 'x', label: 'Remove from calendar', onClick: () => set({ start: '' }) },
    { more: true, icon: 'note', label: task.notes ? 'Edit notes…' : 'Add notes…', onClick: () => ui.openTask(task.id) },
    {
      more: true,
      icon: 'subtask',
      label: 'Add subtask…',
      onClick: async () => {
        const v = await ui.prompt({ title: 'Add subtask', label: task.title, placeholder: 'Subtask title' });
        if (v) actions.addTask({ title: v, parentId: task.id });
      },
    },
    !task.parentId && {
      more: true,
      icon: 'layers',
      label: 'Convert to project…',
      onClick: async () => {
        const name = await ui.prompt({ title: 'Convert to project', label: 'Project name', value: task.title, okLabel: 'Convert' });
        if (!name) return;
        const pid = actions.convertTaskToProject(task.id, name);
        if (pid && !task.inbox) ui.navigate('project', pid);
      },
    },
    { more: true, ...SEP },
    {
      more: true,
      icon: 'trash',
      label: 'Delete task',
      danger: true,
      onClick: async () => {
        if (await ui.confirm({ title: 'Delete task?', message: `"${task.title}" and its subtasks will be permanently deleted.`, okLabel: 'Delete', danger: true })) {
          actions.deleteTask(task.id);
        }
      },
    },
  ];
}

export function projectMenu(project, { state, actions }, ui) {
  const set = (patch) => actions.updateProject(project.id, patch);
  const folder = state.folders[project.folderId];
  return [
    { icon: 'open', label: 'Open project', onClick: () => ui.navigate('project', project.id) },
    { icon: 'pie', label: 'Time spent', onClick: () => ui.navigate('time', project.id) },
    SEP,
    project.inbox
      ? { icon: 'checkCircle', label: 'Processing complete', onClick: () => actions.processComplete('project', project.id) }
      : { icon: 'inbox', label: 'Move to inbox', onClick: () => actions.moveToInbox('project', project.id) },
    {
      icon: 'plus',
      label: 'Add task…',
      onClick: async () => {
        const v = await ui.prompt({ title: 'Add task to ' + project.name, placeholder: 'Task title' });
        if (v) actions.addTask({ title: v, projectId: project.id });
      },
    },
    SEP,
    {
      icon: 'folder',
      label: 'Move to folder',
      hint: truncate(folder?.name, 18),
      submenu: folderSubmenu(state, ui, project.folderId, (fid, newName) => {
        const target = newName ? actions.addFolder({ name: newName }) : fid;
        actions.moveProject(project.id, { folderId: target });
      }),
    },
    { icon: 'flag', label: 'Due date', hint: fmtDay(project.dueDate), submenu: dateSubmenu(ui, project.dueDate, 'Project due date', (v) => set({ dueDate: v })) },
    { icon: 'tag', label: 'Tags', hint: project.tags.length ? String(project.tags.length) : '', submenu: tagsSubmenu(state, ui, project.tags, (tags) => set({ tags }), project.name) },

    {
      more: true,
      icon: 'edit',
      label: 'Rename…',
      onClick: async () => {
        const v = await ui.prompt({ title: 'Rename project', value: project.name });
        if (v) set({ name: v });
      },
    },
    { more: true, icon: project.completed ? 'undo' : 'check', label: project.completed ? 'Reopen project' : 'Complete project', onClick: () => actions.toggleProjectComplete(project.id) },
    { more: true, ...SEP },
    {
      more: true,
      icon: 'trash',
      label: 'Delete project',
      danger: true,
      onClick: async () => {
        if (await ui.confirm({ title: 'Delete project?', message: `"${project.name}" will be deleted. Its tasks will be moved to the inbox.`, okLabel: 'Delete', danger: true })) {
          actions.deleteProject(project.id);
          if (ui.route.id === project.id) ui.navigate('projects');
        }
      },
    },
  ];
}

export function folderMenu(folder, { state, actions }, ui) {
  return [
    {
      icon: 'plus',
      label: 'New project here…',
      onClick: async () => {
        const v = await ui.prompt({ title: 'New project', placeholder: 'Project name' });
        if (v) actions.addProject({ name: v, folderId: folder.id });
      },
    },
    {
      icon: 'folderPlus',
      label: 'New subfolder…',
      onClick: async () => {
        const v = await ui.prompt({ title: 'New folder', placeholder: 'Folder name' });
        if (v) actions.addFolder({ name: v, parentId: folder.id });
      },
    },
    {
      icon: 'edit',
      label: 'Rename…',
      onClick: async () => {
        const v = await ui.prompt({ title: 'Rename folder', value: folder.name });
        if (v) actions.updateFolder(folder.id, { name: v });
      },
    },
    {
      icon: 'folder',
      label: 'Move to',
      submenu: folderSubmenu(state, ui, folder.parentId, (fid, newName) => {
        const target = newName ? actions.addFolder({ name: newName }) : fid;
        actions.moveNode('folder', folder.id, { kind: 'root', id: target });
      }, folder.id),
    },
    {
      more: true,
      icon: 'trash',
      label: 'Delete folder',
      danger: true,
      onClick: async () => {
        if (await ui.confirm({ title: 'Delete folder?', message: `"${folder.name}" will be removed. Its projects and subfolders move up a level.`, okLabel: 'Delete', danger: true })) {
          actions.deleteFolder(folder.id);
        }
      },
    },
  ];
}
