import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseMoney, round2 } from './model';
import { cx } from '../util';

// Money field that commits on Enter/blur. Accepts "£3.50", "3.2+4.5" etc.
export function MoneyInput({ value, onCommit, className, autoFocus, placeholder = '£0', allowEmpty = false, onEnter, ...rest }) {
  const show = (v) => (v == null || v === '' ? '' : String(round2(v)));
  const [text, setText] = useState(show(value));
  const [bad, setBad] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (document.activeElement !== ref.current) setText(show(value)); }, [value]);
  useEffect(() => { if (autoFocus) { ref.current?.focus(); ref.current?.select(); } }, [autoFocus]);
  const commit = () => {
    const v = parseMoney(text);
    if (v == null && !(allowEmpty && text.trim() === '')) { setBad(text.trim() !== ''); if (text.trim() === '') setText(show(value)); return null; }
    setBad(false);
    if (v !== value) onCommit?.(v);
    return v;
  };
  return (
    <span className={cx('money-input', bad && 'bad', className)}>
      <span className="money-sign">£</span>
      <input
        ref={ref}
        inputMode="decimal"
        value={text}
        placeholder={placeholder.replace('£', '')}
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); const v = commit(); onEnter?.(v); }
        }}
        {...rest}
      />
    </span>
  );
}

// A number field that commits on blur/Enter (avoids saving every keystroke).
export function NumberInput({ value, onCommit, min, step = 1, className, ...rest }) {
  const [text, setText] = useState(value ?? '');
  const ref = useRef(null);
  useEffect(() => { if (document.activeElement !== ref.current) setText(value ?? ''); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (text === '' || !Number.isFinite(n) || (min != null && n < min)) { setText(value ?? ''); return; }
    if (n !== value) onCommit(n);
  };
  return (
    <input
      ref={ref}
      type="number"
      className={cx('num-input', className)}
      value={text}
      step={step}
      min={min}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      {...rest}
    />
  );
}

export function TextInput({ value, onCommit, ...rest }) {
  const [text, setText] = useState(value ?? '');
  const ref = useRef(null);
  useEffect(() => { if (document.activeElement !== ref.current) setText(value ?? ''); }, [value]);
  const commit = () => { if (text !== (value ?? '')) onCommit(text); };
  return <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }} {...rest} />;
}

export function Check({ checked, onChange, children, title }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

// Floating panel anchored to a rect, kept on screen; closes on outside click / Escape.
export function Floating({ rect, onClose, children, className, width = 340 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 4, opacity: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const place = () => {
      const h = el.offsetHeight;
      let top = rect.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 4);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPos({ left, top });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rect, width]);
  useEffect(() => {
    const down = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (e.target.closest?.('.modal-backdrop, .ctx-root')) return;
      onClose();
    };
    const key = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose(); };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);
  return <div ref={ref} className={cx('b-float', className)} style={{ ...pos, width }}>{children}</div>;
}

export function Modal({ title, onClose, children, actions, width = 440, className }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop b-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('modal', className)} style={{ width }}>
        {title && <h3>{title}</h3>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
