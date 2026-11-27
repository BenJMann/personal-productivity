import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, useNow } from '../store';
import { todayStr, cx } from '../util';
import { computeBudget, periodAt, fmtMoney, fmtShort, periodRange } from './model';
import MonthView from './MonthView';
import ChartView from './ChartView';
import GoodsView from './GoodsView';
import ReceiptsView from './ReceiptsView';
import LineEditor from './LineEditor';

const BudgetCtx = createContext(null);

function loadView() {
  try { return localStorage.getItem('pp-budget-view') || 'month'; } catch { return 'month'; }
}

// Shared budget state for every budget screen: which month is open, the computed numbers,
// the line editor and undo toasts.
function BudgetProvider({ children }) {
  const { state, actions } = useStore();
  const now = useNow(60000);
  const today = todayStr(new Date(now));
  const budget = state.budget;
  const [view, setViewState] = useState(loadView);
  const [periodId, setPeriodId] = useState(null); // null = the month containing today
  const [editingLine, setEditingLine] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => { actions.ensurePeriods(today); }, [today, actions]);

  const computed = useMemo(() => computeBudget(budget, today), [budget, today]);
  const current = periodAt(budget, today) || budget.periods[budget.periods.length - 1];
  const period = budget.periods.find((p) => p.id === periodId) || current;

  const setView = useCallback((v) => {
    setViewState(v);
    try { localStorage.setItem('pp-budget-view', v); } catch {}
  }, []);

  const showToast = useCallback((msg, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 7000 : 3500);
  }, []);

  // Runs a change and offers to put the budget back as it was.
  const latestBudget = useRef(budget);
  latestBudget.current = budget;
  const withUndo = useCallback((msg, fn) => {
    const snapshot = latestBudget.current;
    const result = fn();
    showToast(msg, () => actions.setBudget(snapshot));
    return result;
  }, [actions, showToast]);

  const value = {
    budget, actions, today, computed, view, setView,
    period, current, result: period ? computed[period.id] : null,
    setPeriodId, editingLine, openLine: setEditingLine, showToast, withUndo,
  };
  return (
    <BudgetCtx.Provider value={value}>
      {children}
      {toast && (
        <div className="b-toast" key={toast.id}>
          <span>{toast.msg}</span>
          {toast.undo && <button className="btn small" onClick={() => { toast.undo(); setToast(null); }}>Undo</button>}
          <button className="icon-btn" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </BudgetCtx.Provider>
  );
}

export const useBudget = () => useContext(BudgetCtx);

function NavItem({ icon, label, count, active, onClick }) {
  return (
    <div className={cx('nav-item', active && 'active')} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {count > 0 && <span className="nav-count">{count}</span>}
    </div>
  );
}

function SideSummary() {
  const { computed, current, today, setView, setPeriodId } = useBudget();
  const r = current && computed[current.id];
  if (!r) return null;
  return (
    <div className="b-side-summary" onClick={() => { setPeriodId(null); setView('month'); }}>
      <div className="b-side-title">{current.name}</div>
      <div className="muted small">{periodRange(current)}</div>
      <div className="b-side-row"><span>Today</span><strong className={r.balanceToday < 0 ? 'danger-text' : ''}>{fmtMoney(r.balanceToday)}</strong></div>
      <div className="b-side-row"><span>End of month</span><strong className={r.closing < 0 ? 'danger-text' : ''}>{fmtMoney(r.closing)}</strong></div>
      {r.low && r.low.balance < 0 && (
        <div className="b-side-warn">Dips to {fmtMoney(r.low.balance)} on {r.low.date === today ? 'today' : fmtShort(r.low.date)}</div>
      )}
    </div>
  );
}

function BudgetSidebar() {
  const { view, setView, budget } = useBudget();
  const toReview = Object.values(budget.receipts).filter((r) => r.status === 'review').length;
  return (
    <nav className="sidebar">
      <div className="b-side-head">Budget</div>
      <div className="nav-main">
        <NavItem icon="▦" label="Month" active={view === 'month'} onClick={() => setView('month')} />
        <NavItem icon="◢" label="Chart" active={view === 'chart'} onClick={() => setView('chart')} />
        <NavItem icon="£" label="Goods & prices" active={view === 'goods'} onClick={() => setView('goods')} />
        <NavItem icon="🧾" label="Receipts" count={toReview} active={view === 'receipts'} onClick={() => setView('receipts')} />
      </div>
      <div className="spacer" />
      <SideSummary />
      <div className="sidebar-foot">
        <div className="muted small b-alt-hint">Press <kbd>Alt</kbd> to switch to Productivity</div>
      </div>
    </nav>
  );
}

function BudgetMain() {
  const { view, editingLine } = useBudget();
  return (
    <>
      <main className="main">
        <div className="main-scroll" key={view}>
          {view === 'chart' ? <ChartView /> : view === 'goods' ? <GoodsView /> : view === 'receipts' ? <ReceiptsView /> : <MonthView />}
        </div>
      </main>
      {editingLine && <LineEditor id={editingLine} />}
    </>
  );
}

export default function BudgetApp() {
  const { state } = useStore();
  if (!state.budget) return null;
  return (
    <BudgetProvider>
      <div className="app budget-app">
        <BudgetSidebar />
        <BudgetMain />
      </div>
    </BudgetProvider>
  );
}
