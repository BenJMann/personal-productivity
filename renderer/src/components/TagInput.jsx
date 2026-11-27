import { useState } from 'react';
import { useStore, allTags } from '../store';

export default function TagInput({ tags, onChange, placeholder = 'Add tag…' }) {
  const { state } = useStore();
  const [text, setText] = useState('');
  const suggestions = allTags(state).filter((t) => !tags.includes(t) && text && t.toLowerCase().startsWith(text.toLowerCase())).slice(0, 6);

  const add = (raw) => {
    const t = raw.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText('');
  };

  return (
    <div className="tag-input">
      {tags.map((t) => (
        <span key={t} className="chip tag-chip">
          #{t}
          <button type="button" className="chip-x" onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <div className="tag-input-wrap">
        <input
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && text.trim()) { e.preventDefault(); add(text); }
            if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
        />
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((s) => <div key={s} onMouseDown={(e) => { e.preventDefault(); add(s); }}>#{s}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
