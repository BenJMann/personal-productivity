import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from './components/Icon';
import { DatePicker, DurationPicker } from './components/Pickers';

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [route, setRoute] = useState({ view: 'inbox' });
  const [editing, setEditing] = useState(null); // { kind: 'task', id }
  const [menu, setMenu] = useState(null); // { x, y, items }
  const [dialog, setDialog] = useState(null);

  const navigate = useCallback((view, id = null) => setRoute({ view, id }), []);
  const openTask = useCallback((id) => setEditing(id ? { kind: 'task', id } : null), []);
  const openMenu = useCallback((e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const ask = (type) => (opts) => new Promise((resolve) => setDialog({ type, ...opts, resolve }));
  const prompt = useCallback(ask('prompt'), []);
  const confirm = useCallback(ask('confirm'), []);
  // Resolve to null on cancel, '' on clear, otherwise 'YYYY-MM-DD' (or 'YYYY-MM-DDTHH:mm' with withTime).
  const pickDate = useCallback(ask('date'), []);
  // Resolves to null on cancel, 0 on clear, otherwise minutes.
  const pickDuration = useCallback(ask('duration'), []);

  const value = useMemo(
    () => ({ route, navigate, editing, openTask, menu, openMenu, closeMenu: () => setMenu(null), prompt, confirm, pickDate, pickDuration }),
    [route, navigate, editing, openTask, menu, openMenu, prompt, confirm, pickDate, pickDuration],
  );

  return (
    <UIContext.Provider value={value}>
      {children}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {dialog && <Dialog {...dialog} onClose={() => setDialog(null)} />}
    </UIContext.Provider>
  );
}

export const useUI = () => useContext(UIContext);

// Drops falsy entries and leading/trailing/doubled separators.
function tidy(items) {
  const out = [];
  for (const it of items) {
    if (!it) continue;
    if (it.separator && (!out.length || out[out.length - 1].separator)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

function MenuItem({ item, onClose, flip, open, onHover }) {
  const hasSub = item.submenu && tidy(item.submenu).length > 0;
  return (
    <div
      className={'ctx-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '') + (open ? ' open' : '')}
      onMouseEnter={onHover}
      onClick={() => {
        if (item.disabled || hasSub) return;
        onClose();
        item.onClick?.();
      }}
    >
      <span className="ctx-icon">{item.checked ? <Icon name="check" /> : item.icon ? <Icon name={item.icon} /> : null}</span>
      <span className="ctx-label">{item.label}</span>
      {item.hint && <span className="ctx-hint">{item.hint}</span>}
      {hasSub && <span className="ctx-arrow"><Icon name="chevronRight" size={13} /></span>}
      {hasSub && open && <MenuList items={item.submenu} onClose={onClose} flip={flip} sub />}
    </div>
  );
}

function MenuList({ items, onClose, flip, sub = false }) {
  const [openSub, setOpenSub] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const all = tidy(items);
  const main = tidy(all.filter((i) => !i.more));
  const more = tidy(all.filter((i) => i.more));
  const ref = useRef(null);
  const [shiftY, setShiftY] = useState(0);

  // Keep submenus on screen vertically.
  useLayoutEffect(() => {
    if (!sub || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const over = r.bottom - window.innerHeight + 8;
    if (over > 0) setShiftY(-over);
  }, [sub]);

  const render = (list, prefix) => list.map((item, i) => {
    const key = prefix + i;
    if (item.separator) return <div key={key} className="ctx-sep" />;
    if (item.header) return <div key={key} className="ctx-header">{item.header}</div>;
    return <MenuItem key={key} item={item} onClose={onClose} flip={flip} open={openSub === key} onHover={() => setOpenSub(key)} />;
  });

  return (
    <div
      ref={ref}
      className={'ctx-menu' + (sub ? ' sub' : '')}
      style={sub ? { position: 'absolute', top: -6 + shiftY, ...(flip ? { right: 'calc(100% - 4px)' } : { left: 'calc(100% - 4px)' }) } : undefined}
      onContextMenu={(e) => e.preventDefault()}
    >
      {render(main, 'm')}
      {more.length > 0 && (
        <>
          <div className="ctx-sep" />
          <div className="ctx-item more-toggle" onMouseEnter={() => setOpenSub(null)} onClick={(e) => { e.stopPropagation(); setShowMore(!showMore); }}>
            <span className="ctx-icon"><Icon name={showMore ? 'chevronDown' : 'more'} /></span>
            <span className="ctx-label">{showMore ? 'Fewer options' : 'More options'}</span>
            {!showMore && <span className="ctx-hint">{more.filter((i) => !i.separator).length}</span>}
          </div>
          {showMore && render(more, 'x')}
        </>
      )}
    </div>
  );
}

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Re-clamp whenever the menu changes size (e.g. "More options" expanded).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const clamp = () => {
      const menuEl = el.firstChild;
      if (!menuEl) return;
      const w = menuEl.offsetWidth;
      const h = menuEl.offsetHeight;
      setPos({
        left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
      });
    };
    clamp();
    const ro = new ResizeObserver(clamp);
    ro.observe(el.firstChild);
    return () => ro.disconnect();
  }, [x, y]);

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctx-root" style={pos}>
      <MenuList items={items} onClose={onClose} flip={pos.left + 520 > window.innerWidth} />
    </div>
  );
}

function Dialog({ type, title, message, label, value = '', placeholder, okLabel, danger, withTime, resolve, onClose }) {
  const [text, setText] = useState(value);
  const inputRef = useRef(null);
  useEffect(() => { if (type === 'prompt') { inputRef.current?.focus(); inputRef.current?.select(); } }, [type]);
  const done = (result) => { resolve(result); onClose(); };
  const cancelValue = type === 'confirm' ? false : null;
  const backdrop = (content) => (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) done(cancelValue); }}>{content}</div>
  );

  if (type === 'date') {
    return backdrop(<DatePicker title={title} value={value} withTime={withTime} onDone={done} onCancel={() => done(null)} />);
  }
  if (type === 'duration') {
    return backdrop(<DurationPicker title={title} value={value || null} onDone={done} onCancel={() => done(null)} />);
  }

  return backdrop(
    <form
      className="modal"
      onSubmit={(e) => { e.preventDefault(); done(type === 'prompt' ? text.trim() || null : true); }}
      onKeyDown={(e) => { if (e.key === 'Escape') done(cancelValue); }}
    >
      <h3>{title}</h3>
      {message && <p className="muted">{message}</p>}
      {type === 'prompt' && (
        <label className="field">
          {label && <span>{label}</span>}
          <input ref={inputRef} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={() => done(cancelValue)}>Cancel</button>
        <button type="submit" autoFocus={type === 'confirm'} className={'btn ' + (danger ? 'danger' : 'primary')}>
          {okLabel || (type === 'prompt' ? 'Save' : 'OK')}
        </button>
      </div>
    </form>,
  );
}
