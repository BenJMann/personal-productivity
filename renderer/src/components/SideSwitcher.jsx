import { useEffect, useState } from 'react';
import { cx } from '../util';

export const SIDES = [
  { id: 'productivity', label: 'Productivity', icon: '☑', hint: 'Tasks, projects, calendar, time', key: 'p' },
  { id: 'budget', label: 'Budget', icon: '£', hint: 'Months, spending, goods, receipts', key: 'b' },
];

export function loadSide() {
  try { return localStorage.getItem('pp-side') || 'productivity'; } catch { return 'productivity'; }
}

// Pressing and releasing Alt on its own opens the switcher (Alt+anything else is left alone).
export function useAltMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alone = false;
    const down = (e) => {
      if (e.key === 'Alt') { if (!e.repeat) alone = true; } else alone = false;
    };
    const up = (e) => {
      if (e.key === 'Alt' && alone) { e.preventDefault(); setOpen((o) => !o); }
      alone = false;
    };
    const reset = () => { alone = false; };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('mousedown', reset, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('mousedown', reset, true);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return [open, setOpen];
}

export default function SideSwitcher({ side, onPick, onClose }) {
  const [sel, setSel] = useState(Math.max(0, SIDES.findIndex((s) => s.id === side)));
  useEffect(() => {
    const key = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') onClose();
      else if (k === 'arrowdown' || k === 'arrowright' || k === 'tab') setSel((i) => (i + 1) % SIDES.length);
      else if (k === 'arrowup' || k === 'arrowleft') setSel((i) => (i + SIDES.length - 1) % SIDES.length);
      else if (k === 'enter') onPick(SIDES[sel].id);
      else {
        const hit = SIDES.findIndex((s, i) => s.key === k || String(i + 1) === k);
        if (hit < 0) return;
        onPick(SIDES[hit].id);
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [sel, onPick, onClose]);

  return (
    <div className="side-switch-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="side-switch">
        {SIDES.map((s, i) => (
          <button key={s.id} className={cx('side-option', i === sel && 'sel', s.id === side && 'current')} onMouseEnter={() => setSel(i)} onClick={() => onPick(s.id)}>
            <span className="side-icon">{s.icon}</span>
            <span className="side-text">
              <span className="side-label">{s.label}{s.id === side && <span className="muted small"> · open</span>}</span>
              <span className="muted small">{s.hint}</span>
            </span>
            <kbd>{i + 1}</kbd>
          </button>
        ))}
        <div className="muted small side-foot">↑↓ Enter · Esc to close · Alt to toggle</div>
      </div>
    </div>
  );
}
