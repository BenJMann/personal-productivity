import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { useUI } from './ui';
import Sidebar from './components/Sidebar';
import TaskEditor from './components/TaskEditor';
import Inbox from './views/Inbox';
import Today from './views/Today';
import TaskView from './views/TaskView';
import Calendar from './views/Calendar';
import Tags from './views/Tags';
import Time from './views/Time';
import { ProjectsOverview, ProjectPage } from './views/Projects';
import { dateTimeStr, fmtTime, fmtDateTime } from './util';
import BudgetApp from './budget/BudgetApp';
import SideSwitcher, { useAltMenu, loadSide } from './components/SideSwitcher';

const LOOKBACK_MS = 12 * 3600 * 1000; // don't alert for things that started long ago

function useStartNotifications() {
  const { state, actions } = useStore();
  const ui = useUI();
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const check = () => {
      const s = latest.current;
      if (s.paused) return;
      const now = dateTimeStr(new Date());
      const oldest = dateTimeStr(new Date(Date.now() - LOOKBACK_MS));
      const due = Object.values(s.tasks).filter(
        (t) => !t.completed && t.start && t.start <= now && t.start >= oldest && s.notified[t.id] !== t.start,
      );
      if (!due.length) return;
      for (const t of due) {
        const payload = { title: `Ready to start: ${t.title}`, body: `Scheduled for ${fmtTime(t.start)}${t.nextAction ? ` — next: ${t.nextAction}` : ''}`, taskId: t.id };
        if (window.api) window.api.notify(payload);
        else if ('Notification' in window && Notification.permission === 'granted') new Notification(payload.title, { body: payload.body });
      }
      actions.markNotified(due.map((t) => t.id));
    };
    check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [actions]);

  useEffect(() => {
    if (!window.api) return undefined;
    return window.api.onNotificationClick((taskId) => { if (taskId) ui.openTask(taskId); });
  }, [ui.openTask]); // eslint-disable-line react-hooks/exhaustive-deps
}

function AlertBanner() {
  const { state, actions } = useStore();
  const ui = useUI();
  const alerts = state.alerts.map((id) => state.tasks[id]).filter((t) => t && !t.completed);
  if (!alerts.length) return null;
  return (
    <div className="alert-banner">
      {alerts.map((t) => (
        <div key={t.id} className="alert-item">
          <span className="alert-icon">⏰</span>
          <div className="alert-text">
            <strong>Time to start: {t.title}</strong>
            <span className="muted"> · scheduled {fmtTime(t.start)}{t.nextAction ? ` · next: ${t.nextAction}` : ''}</span>
          </div>
          <button className="btn primary small" onClick={() => actions.startTimer(t.id)}>▶ Start timer</button>
          <button className="btn small" onClick={() => ui.openTask(t.id)}>Open</button>
          <button className="btn ghost small" onClick={() => actions.dismissAlert(t.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}

function MissedBanner() {
  const { state, actions } = useStore();
  const ui = useUI();
  const missed = state.missed.map((id) => state.tasks[id]).filter((t) => t && !t.completed);
  if (!missed.length) return null;
  return (
    <div className="missed-banner">
      <div>
        <strong>Welcome back.</strong> {missed.length} scheduled task{missed.length > 1 ? 's' : ''} passed while you were away:{' '}
        {missed.map((t, i) => <span key={t.id}>{i ? ', ' : ''}<a onClick={() => ui.openTask(t.id)}>{t.title}</a></span>)}
      </div>
      <div className="row">
        <button className="btn small" onClick={() => actions.clearMissed({ toInbox: true })}>Move them to inbox</button>
        <button className="btn ghost small" onClick={() => actions.clearMissed()}>Dismiss</button>
      </div>
    </div>
  );
}

function PauseOverlay() {
  const { state, actions } = useStore();
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (state.paused) setHidden(false); }, [state.paused]);
  if (!state.paused || hidden) return null;
  return (
    <div className="pause-overlay">
      <div className="pause-card">
        <div className="pause-icon">❚❚</div>
        <h2>Activity paused</h2>
        <p>Timers are stopped and notifications are silenced{state.pausedAt ? ` since ${fmtDateTime(dateTimeStr(new Date(state.pausedAt)))}` : ''}.</p>
        <p className="muted">Take as long as you need. Nothing will nag you, and anything you miss will be waiting quietly when you come back.</p>
        <div className="row center">
          <button className="btn primary" onClick={() => actions.resume()}>▶ I'm back — resume</button>
          <button className="btn ghost" onClick={() => setHidden(true)}>Look around while paused</button>
        </div>
      </div>
    </div>
  );
}

function MainView() {
  const { route } = useUI();
  switch (route.view) {
    case 'today': return <Today />;
    case 'taskview': return <TaskView viewId={route.id} />;
    case 'calendar': return <Calendar />;
    case 'projects': return <ProjectsOverview />;
    case 'project': return <ProjectPage id={route.id} />;
    case 'tags': return <Tags tag={route.id} />;
    case 'time': return <Time projectId={route.id} />;
    default: return <Inbox />;
  }
}

export default function App() {
  const [side, setSide] = useState(loadSide);
  const [menuOpen, setMenuOpen] = useAltMenu();
  useStartNotifications(); // task reminders keep firing on the budget side too

  const pick = (s) => {
    setSide(s);
    setMenuOpen(false);
    try { localStorage.setItem('pp-side', s); } catch {}
  };

  return (
    <>
      {side === 'budget' ? <BudgetApp /> : <ProductivityApp />}
      {menuOpen && <SideSwitcher side={side} onPick={pick} onClose={() => setMenuOpen(false)} />}
    </>
  );
}

function ProductivityApp() {
  const { state } = useStore();
  const ui = useUI();

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {state.paused && <div className="paused-strip">❚❚ Activity paused — timers and notifications are off</div>}
        <AlertBanner />
        <MissedBanner />
        <div className="main-scroll" key={ui.route.view + (ui.route.id || '')}>
          <MainView />
        </div>
        <PauseOverlay />
      </main>
      {ui.editing && <TaskEditor id={ui.editing.id} />}
    </div>
  );
}
