// Query engine behind the Task view: field definitions, operators and evaluation.
import { taskProjectId, subtasksOf, folderDescendants, projectHasNextActions, folderPath } from './store';
import { todayStr, addDays, uid, PRIORITIES } from './util';

export const OPS = {
  text: [['contains', 'contains'], ['not_contains', "doesn't contain"], ['equals', 'is exactly'], ['set', 'is set'], ['empty', 'is empty']],
  tags: [['has', 'includes'], ['not_has', "doesn't include"], ['any', 'has any tag'], ['none', 'has no tags']],
  project: [['is', 'is'], ['is_not', 'is not'], ['set', 'is set'], ['empty', 'is empty']],
  folder: [['in', 'is in'], ['not_in', 'is not in'], ['empty', 'is top level']],
  priority: [['eq', 'is'], ['gte', 'is at least'], ['lte', 'is at most']],
  date: [['set', 'is set'], ['empty', 'is empty'], ['today', 'is today'], ['overdue', 'is before today'], ['next_days', 'is within the next … days'], ['on', 'is on'], ['before', 'is before'], ['after', 'is after']],
  number: [['gt', 'is more than'], ['lt', 'is less than'], ['eq', 'equals'], ['set', 'is set'], ['empty', 'is empty']],
  bool: [['true', 'yes'], ['false', 'no']],
};

// Operators that need no value input.
export const NO_VALUE = new Set(['set', 'empty', 'any', 'none', 'today', 'overdue', 'true', 'false']);

export const TASK_FIELDS = {
  title: { label: 'Title', type: 'text', get: (t) => t.title },
  nextAction: { label: 'Next action', type: 'text', get: (t) => t.nextAction },
  notes: { label: 'Notes', type: 'text', get: (t) => t.notes },
  tag: { label: 'Tags', type: 'tags', get: (t) => t.tags },
  project: { label: 'Project', type: 'project', get: (t, s) => taskProjectId(s, t) },
  folder: { label: 'Project folder', type: 'folder', get: (t, s) => s.projects[taskProjectId(s, t)]?.folderId || null },
  priority: { label: 'Priority', type: 'priority', get: (t) => t.priority },
  day: { label: 'Assigned day', type: 'date', get: (t) => t.day },
  start: { label: 'Start date', type: 'date', get: (t) => t.start.slice(0, 10) },
  dueDate: { label: 'Due date', type: 'date', get: (t) => t.dueDate },
  createdAt: { label: 'Created', type: 'date', get: (t) => t.createdAt.slice(0, 10) },
  completedAt: { label: 'Completed on', type: 'date', get: (t) => (t.completedAt || '').slice(0, 10) },
  estimate: { label: 'Estimate (min)', type: 'number', get: (t) => t.estimate },
  completed: { label: 'Is completed', type: 'bool', get: (t) => t.completed },
  inbox: { label: 'Is in inbox', type: 'bool', get: (t) => t.inbox },
  hasSubtasks: { label: 'Has subtasks', type: 'bool', get: (t, s) => subtasksOf(s, t.id).length > 0 },
  isSubtask: { label: 'Is a subtask', type: 'bool', get: (t) => !!t.parentId },
};

export const PROJECT_FIELDS = {
  name: { label: 'Name', type: 'text', get: (p) => p.name },
  notes: { label: 'Notes', type: 'text', get: (p) => p.notes },
  tag: { label: 'Tags', type: 'tags', get: (p) => p.tags },
  folder: { label: 'Folder', type: 'folder', get: (p) => p.folderId },
  dueDate: { label: 'Due date', type: 'date', get: (p) => p.dueDate },
  hasNextActions: { label: 'Has tasks with next actions', type: 'bool', get: (p, s) => projectHasNextActions(s, p.id) },
  openTasks: { label: 'Open tasks', type: 'number', get: (p, s) => openTaskCount(s, p.id) },
  completed: { label: 'Is completed', type: 'bool', get: (p) => p.completed },
  inbox: { label: 'Is in inbox', type: 'bool', get: (p) => p.inbox },
};

function openTaskCount(s, pid) {
  return Object.values(s.tasks).filter((t) => !t.completed && !t.parentId && t.projectId === pid).length;
}

export const fieldsFor = (entity) => (entity === 'projects' ? PROJECT_FIELDS : TASK_FIELDS);

export const GROUPS = {
  tasks: [['project', 'Project'], ['folder', 'Folder'], ['tag', 'Tag'], ['priority', 'Priority'], ['day', 'Assigned day'], ['dueDate', 'Due date'], ['none', 'No grouping']],
  projects: [['folder', 'Folder'], ['tag', 'Tag'], ['none', 'No grouping']],
};

export const SORTS = {
  tasks: [['priority', 'Priority'], ['dueDate', 'Due date'], ['day', 'Assigned day'], ['title', 'Title'], ['createdAt', 'Newest']],
  projects: [['name', 'Name'], ['dueDate', 'Due date'], ['createdAt', 'Newest']],
};

function testCondition(item, cond, state, fields) {
  const field = fields[cond.field];
  if (!field) return true;
  const v = field.get(item, state);
  const val = cond.value;
  const today = todayStr();
  switch (field.type) {
    case 'text': {
      const s = (v || '').toLowerCase();
      const q = (val || '').toLowerCase();
      if (cond.op === 'contains') return s.includes(q);
      if (cond.op === 'not_contains') return !s.includes(q);
      if (cond.op === 'equals') return s === q;
      if (cond.op === 'set') return !!s.trim();
      if (cond.op === 'empty') return !s.trim();
      return true;
    }
    case 'tags':
      if (cond.op === 'has') return !val || v.includes(val);
      if (cond.op === 'not_has') return !v.includes(val);
      if (cond.op === 'any') return v.length > 0;
      if (cond.op === 'none') return v.length === 0;
      return true;
    case 'project':
      if (cond.op === 'is') return v === val;
      if (cond.op === 'is_not') return v !== val;
      if (cond.op === 'set') return !!v;
      if (cond.op === 'empty') return !v;
      return true;
    case 'folder': {
      if (cond.op === 'empty') return !v;
      const inside = !!val && !!v && folderDescendants(state, val).includes(v);
      return cond.op === 'in' ? inside : !inside;
    }
    case 'priority':
      if (cond.op === 'eq') return v === Number(val);
      if (cond.op === 'gte') return v >= Number(val);
      if (cond.op === 'lte') return v <= Number(val);
      return true;
    case 'date':
      if (cond.op === 'set') return !!v;
      if (cond.op === 'empty') return !v;
      if (!v) return false;
      if (cond.op === 'today') return v === today;
      if (cond.op === 'overdue') return v < today;
      if (cond.op === 'next_days') return v >= today && v <= addDays(today, Number(val) || 0);
      if (cond.op === 'on') return v === val;
      if (cond.op === 'before') return !!val && v < val;
      if (cond.op === 'after') return !!val && v > val;
      return true;
    case 'number':
      if (cond.op === 'set') return v != null && v !== '';
      if (cond.op === 'empty') return v == null || v === '';
      if (v == null) return false;
      if (cond.op === 'gt') return v > Number(val);
      if (cond.op === 'lt') return v < Number(val);
      if (cond.op === 'eq') return v === Number(val);
      return true;
    case 'bool':
      return cond.op === 'true' ? !!v : !v;
    default:
      return true;
  }
}

export function defaultQuery() {
  return { entity: 'tasks', match: 'all', conditions: [], groupBy: 'project', sortBy: 'priority', showCompleted: false, includeSubtasks: false, search: '' };
}

export function newCondition(entity) {
  const first = entity === 'projects' ? 'name' : 'title';
  return { id: uid(), field: first, op: 'contains', value: '' };
}

export function runQuery(state, q) {
  const fields = fieldsFor(q.entity);
  let items = q.entity === 'projects' ? Object.values(state.projects) : Object.values(state.tasks);
  if (q.entity === 'tasks' && !q.includeSubtasks) items = items.filter((t) => !t.parentId);
  if (!q.showCompleted) items = items.filter((t) => !t.completed);
  if (q.search) {
    const s = q.search.toLowerCase();
    items = items.filter((i) => [i.title, i.name, i.notes, i.nextAction, ...i.tags].some((x) => x && x.toLowerCase().includes(s)));
  }
  if (q.conditions.length) {
    const test = (i) => q.conditions.map((c) => testCondition(i, c, state, fields));
    items = items.filter((i) => (q.match === 'any' ? test(i).some(Boolean) : test(i).every(Boolean)));
  }
  const sorters = {
    priority: (a, b) => b.priority - a.priority || (a.dueDate || '9').localeCompare(b.dueDate || '9'),
    dueDate: (a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'),
    day: (a, b) => (a.day || '9').localeCompare(b.day || '9'),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    name: (a, b) => a.name.localeCompare(b.name),
    createdAt: (a, b) => b.createdAt.localeCompare(a.createdAt),
  };
  items.sort(sorters[q.sortBy] || sorters.createdAt);
  return items;
}

// Returns [{ key, label, projectId?, items }] in a sensible order.
export function groupItems(state, items, q) {
  const by = q.groupBy;
  if (by === 'none') return [{ key: 'all', label: null, items }];
  const groups = new Map();
  const push = (key, label, item, extra = {}) => {
    if (!groups.has(key)) groups.set(key, { key, label, items: [], ...extra });
    groups.get(key).items.push(item);
  };
  const folderLabel = (fid) => folderPath(state, fid).map((f) => f.name).join(' / ');
  for (const item of items) {
    if (by === 'project') {
      const pid = taskProjectId(state, item);
      push(pid || '~none', pid ? state.projects[pid]?.name : 'No project', item, { projectId: pid });
    } else if (by === 'folder') {
      const fid = q.entity === 'projects' ? item.folderId : state.projects[taskProjectId(state, item)]?.folderId;
      push(fid || '~none', fid ? folderLabel(fid) : 'No folder', item);
    } else if (by === 'tag') {
      if (!item.tags.length) push('~none', 'Untagged', item);
      item.tags.forEach((t) => push(t, '#' + t, item));
    } else if (by === 'priority') {
      push(String(3 - item.priority), PRIORITIES[item.priority].label + ' priority', item);
    } else if (by === 'day' || by === 'dueDate') {
      push(item[by] || '~none', item[by] || (by === 'day' ? 'No day assigned' : 'No due date'), item, { date: item[by] });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === '~none') return 1;
    if (b.key === '~none') return -1;
    if (by === 'priority' || by === 'day' || by === 'dueDate') return a.key.localeCompare(b.key);
    return (a.label || '').localeCompare(b.label || '');
  });
}

export const PRESETS = [
  { name: 'All tasks by project', query: defaultQuery() },
  { name: 'Tasks with next actions', query: { ...defaultQuery(), conditions: [{ id: 'p1', field: 'nextAction', op: 'set', value: '' }] } },
  { name: 'Tasks without next actions', query: { ...defaultQuery(), conditions: [{ id: 'p1', field: 'nextAction', op: 'empty', value: '' }] } },
  { name: 'Projects with next actions', query: { ...defaultQuery(), entity: 'projects', groupBy: 'folder', sortBy: 'name', conditions: [{ id: 'p1', field: 'hasNextActions', op: 'true', value: '' }] } },
  { name: 'Projects without next actions', query: { ...defaultQuery(), entity: 'projects', groupBy: 'folder', sortBy: 'name', conditions: [{ id: 'p1', field: 'hasNextActions', op: 'false', value: '' }] } },
  { name: 'Overdue', query: { ...defaultQuery(), groupBy: 'dueDate', sortBy: 'dueDate', conditions: [{ id: 'p1', field: 'dueDate', op: 'overdue', value: '' }] } },
  { name: 'Due in the next 7 days', query: { ...defaultQuery(), groupBy: 'dueDate', sortBy: 'dueDate', conditions: [{ id: 'p1', field: 'dueDate', op: 'next_days', value: '7' }] } },
  { name: 'High priority', query: { ...defaultQuery(), groupBy: 'project', conditions: [{ id: 'p1', field: 'priority', op: 'eq', value: '3' }] } },
  { name: 'Not scheduled', query: { ...defaultQuery(), conditions: [{ id: 'p1', field: 'day', op: 'empty', value: '' }, { id: 'p2', field: 'start', op: 'empty', value: '' }] } },
];
