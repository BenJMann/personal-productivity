import { useState } from 'react';
import { useStore } from '../store';
import { todayStr, addDays } from '../util';

// Parses inline shortcuts: #tag, !1..!3 (priority), @today / @tomorrow.
export function parseQuick(text) {
  const fields = { tags: [] };
  const words = [];
  for (const w of text.trim().split(/\s+/)) {
    if (/^#\S+/.test(w)) fields.tags.push(w.slice(1));
    else if (/^![1-3]$/.test(w)) fields.priority = Number(w[1]);
    else if (/^!(high|med|medium|low)$/i.test(w)) fields.priority = { low: 1, med: 2, medium: 2, high: 3 }[w.slice(1).toLowerCase()];
    else if (/^@today$/i.test(w)) fields.day = todayStr();
    else if (/^@tomorrow$/i.test(w)) fields.day = addDays(todayStr(), 1);
    else words.push(w);
  }
  fields.title = words.join(' ');
  return fields;
}

export default function QuickEntry({ defaults = {}, placeholder = 'Capture anything…', autoFocus = false, hint = true }) {
  const { actions } = useStore();
  const [text, setText] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [showNext, setShowNext] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    const fields = parseQuick(text);
    if (!fields.title) return;
    actions.addTask({ ...defaults, ...fields, tags: [...new Set([...(defaults.tags || []), ...fields.tags])], nextAction: nextAction.trim() });
    setText('');
    setNextAction('');
  };

  return (
    <form className="quick-entry" onSubmit={submit}>
      <div className="quick-row">
        <span className="quick-plus">+</span>
        <input
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey && text) { e.preventDefault(); setShowNext(true); } }}
        />
        <button type="button" className={'btn ghost small' + (showNext ? ' active' : '')} onClick={() => setShowNext(!showNext)} title="Add a next action (Tab)">
          → next action
        </button>
        <button type="submit" className="btn primary small">Add</button>
      </div>
      {showNext && (
        <div className="quick-row sub">
          <span className="quick-plus">→</span>
          <input autoFocus value={nextAction} placeholder="Next action (optional)" onChange={(e) => setNextAction(e.target.value)} />
        </div>
      )}
      {hint && <div className="quick-hint">Shortcuts: <code>#tag</code> <code>!1</code>–<code>!3</code> priority <code>@today</code> <code>@tomorrow</code> · Tab to add a next action</div>}
    </form>
  );
}
