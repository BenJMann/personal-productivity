import { useEffect, useMemo, useRef, useState } from 'react';
import { useBudget } from './BudgetApp';
import { fmtMoney, fmtShort, periodRange, periodIndex, round2 } from './model';
import { parseDay, DAY_NAMES, cx, fmtDay } from '../util';

// Categorical hues (dark-surface steps), assigned in this fixed order. Past 7 bands the rest
// fold into "Other" so no hue is ever generated or reused.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767'];
const OTHER = '#7d8593';
const MAX_BANDS = SERIES.length;

function useWidth(ref) {
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

// Bands for the stack: each is a set of lines with a running (actual + forecast) total per day.
function buildBands(result, by) {
  const out = result.lines.filter((l) => l.kind !== 'income');
  let groups;
  if (by === 'line') groups = out.map((l) => ({ id: l.id, name: l.name, lines: [l] }));
  else {
    groups = result.sections.filter((s) => !s.income).map((s) => ({ id: s.id, name: s.name || 'Spending', lines: s.lines }));
  }
  const total = (g) => g.lines.reduce((s, l) => s + result.stats[l.id].total, 0);
  groups = groups.filter((g) => total(g) > 0.004).sort((a, b) => total(b) - total(a));
  if (groups.length > MAX_BANDS) {
    const keep = groups.slice(0, MAX_BANDS - 1);
    keep.push({ id: 'other', name: 'Other', lines: groups.slice(MAX_BANDS - 1).flatMap((g) => g.lines), other: true });
    groups = keep;
  }
  return groups.map((g, i) => {
    let cum = 0;
    const perDay = result.days.map((d) => {
      const v = g.lines.reduce((s, l) => { const c = result.cells[`${l.id}|${d}`]; return s + (c ? c.actual + c.predicted : 0); }, 0);
      cum += v;
      return { day: v, cum: round2(cum) };
    });
    return { ...g, color: g.other ? OTHER : SERIES[i], perDay, total: round2(cum) };
  });
}

function Chart({ result, bands, today }) {
  const boxRef = useRef(null);
  const W = useWidth(boxRef);
  const H = 400;
  const pad = { l: 64, r: 16, t: 14, b: 30 };
  const [hover, setHover] = useState(null);
  const n = result.days.length;

  // Point j (0..n) is the position after j days; j = 0 is the starting balance.
  const pts = useMemo(() => {
    const arr = [{ top: result.opening, bal: result.opening, cums: bands.map(() => 0) }];
    let inCum = 0;
    result.daily.forEach((d, i) => {
      inCum += d.aIn + d.pIn;
      arr.push({ top: round2(result.opening + inCum), bal: d.balance, cums: bands.map((b) => b.perDay[i].cum) });
    });
    return arr;
  }, [result, bands]);

  const maxY = Math.max(1, ...pts.map((p) => p.top));
  const minY = Math.min(0, ...pts.map((p) => p.bal));
  const x = (j) => pad.l + (j / n) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((maxY - v) / (maxY - minY || 1)) * (H - pad.t - pad.b);
  const area = (lo, hi) => {
    const up = pts.map((p, j) => `${x(j)},${y(hi(p, j))}`).join(' L');
    const down = pts.map((p, j) => `${x(j)},${y(lo(p, j))}`).reverse().join(' L');
    return `M${up} L${down} Z`;
  };
  const tIdx = result.days.indexOf(today);
  const splitJ = result.status === 'past' ? n : result.status === 'future' ? 0 : tIdx + 1;
  const splitX = x(splitJ);

  const ticks = useMemo(() => {
    const step = Math.pow(10, Math.floor(Math.log10(maxY - minY || 1)));
    const s = [1, 2, 5, 10].map((k) => k * step / 2).find((k) => (maxY - minY) / k <= 6) || step;
    const out = [];
    for (let v = Math.ceil(minY / s) * s; v <= maxY; v += s) out.push(round2(v));
    return out;
  }, [maxY, minY]);

  let lastTickX = -Infinity;
  const dayTicks = result.days.map((d, i) => ({ d, i })).filter(({ d, i }) => {
    const dt = parseDay(d);
    const want = i === 0 || dt.getDate() === 1 || (n <= 35 ? dt.getDay() === 1 : dt.getDate() % 7 === 1);
    if (!want || x(i + 0.5) - lastTickX < 48) return false;
    lastTickX = x(i + 0.5);
    return true;
  });

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const j = Math.round(((e.clientX - r.left - pad.l) / (W - pad.l - pad.r)) * n);
    setHover(j >= 1 && j <= n ? j : null);
  };

  const hp = hover != null ? pts[hover] : null;
  const hd = hover != null ? result.days[hover - 1] : null;

  const layers = [];
  let below = (p) => p.bal;
  bands.forEach((b, k) => {
    const lo = below;
    const hi = (p) => lo(p) + p.cums[k];
    layers.push({ b, path: area(lo, hi) });
    below = hi;
  });

  return (
    <div className="b-chart-box" ref={boxRef}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="b-chart">
        <defs>
          <clipPath id="clip-past"><rect x={0} y={0} width={splitX} height={H} /></clipPath>
          <clipPath id="clip-future"><rect x={splitX} y={0} width={Math.max(0, W - splitX)} height={H} /></clipPath>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={cx('b-gridline', v === 0 && 'zero')} />
            <text x={pad.l - 8} y={y(v) + 4} className="b-axis" textAnchor="end">{fmtMoney(v)}</text>
          </g>
        ))}
        {dayTicks.map(({ d, i }) => (
          <text key={d} x={x(i + 0.5)} y={H - 10} className="b-axis" textAnchor="middle">{fmtShort(d)}</text>
        ))}
        {['past', 'future'].map((part) => (
          <g key={part} clipPath={`url(#clip-${part})`} opacity={part === 'future' ? 0.55 : 1}>
            <path d={area(() => 0, (p) => Math.max(0, p.bal))} className="b-band-balance" />
            {layers.map(({ b, path }) => <path key={b.id} d={path} fill={b.color} stroke="var(--bg-1)" strokeWidth="1" />)}
            {part === 'future' && layers.map(({ b, path }) => <path key={b.id + 'h'} d={path} fill="url(#hatch)" />)}
            <path d={area((p) => Math.min(0, p.bal), () => 0)} className="b-band-neg" />
          </g>
        ))}
        <path d={'M' + pts.map((p, j) => `${x(j)},${y(p.bal)}`).join(' L')} className="b-bal-line" />
        <path d={'M' + pts.map((p, j) => `${x(j)},${y(p.top)}`).join(' L')} className="b-top-line" />
        {result.status === 'current' && (
          <g>
            <line x1={splitX} x2={splitX} y1={pad.t} y2={H - pad.b} className="b-today-line" />
            <text x={splitX + 4} y={pad.t + 10} className="b-axis strong">today</text>
          </g>
        )}
        {hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="b-cross" />
            <circle cx={x(hover)} cy={y(hp.bal)} r={4.5} className="b-dot" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="b-tip" style={{ left: Math.min(x(hover) + 14, W - 250), top: 20 }}>
          <div className="b-tip-head">{fmtDay(hd)}{hd > today ? <span className="muted"> · forecast</span> : ''}</div>
          <div className="b-tip-row strong"><span>Balance</span><span className={hp.bal < 0 ? 'danger-text' : ''}>{fmtMoney(hp.bal)}</span></div>
          <div className="b-tip-row"><span>Money in so far</span><span>{fmtMoney(hp.top)}</span></div>
          {bands.map((b, k) => (
            <div key={b.id} className="b-tip-row">
              <span><i className="b-swatch" style={{ background: b.color }} />{b.name}</span>
              <span>{fmtMoney(hp.cums[k])}{b.perDay[hover - 1].day >= 0.005 && <span className="muted"> (+{fmtMoney(b.perDay[hover - 1].day)})</span>}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChartView() {
  const { budget, computed, period, current, setPeriodId, today, openLine } = useBudget();
  const [by, setBy] = useState(() => { try { return localStorage.getItem('pp-budget-chart-by') || 'group'; } catch { return 'group'; } });
  const result = period && computed[period.id];
  const bands = useMemo(() => (result ? buildBands(result, by) : []), [result, by]);
  if (!result) return null;
  const idx = periodIndex(budget, period.id);
  const go = (d) => { const p = budget.periods[idx + d]; if (p) setPeriodId(p.id === current.id ? null : p.id); };
  const setByMode = (v) => { setBy(v); try { localStorage.setItem('pp-budget-chart-by', v); } catch {} };
  const outLines = result.lines.filter((l) => l.kind !== 'income');
  const maxLine = Math.max(1, ...outLines.map((l) => Math.max(result.stats[l.id].total, result.stats[l.id].budget || 0)));

  return (
    <div className="view b-chart-view">
      <div className="view-head">
        <button className="icon-btn" disabled={idx <= 0} onClick={() => go(-1)}>‹</button>
        <h1>{period.name}</h1>
        <button className="icon-btn" disabled={idx >= budget.periods.length - 1} onClick={() => go(1)}>›</button>
        <span className="muted">{periodRange(period)}</span>
        <span className="spacer" />
        <div className="segmented">
          <button className={cx(by === 'group' && 'active')} onClick={() => setByMode('group')}>By group</button>
          <button className={cx(by === 'line' && 'active')} onClick={() => setByMode('line')}>By line</button>
        </div>
      </div>
      <p className="muted small">
        The top edge is all the money you'll have had (start + income). Coloured bands are what's gone out, so the grey area underneath is what's left.
        Hatched and faded after today = forecast.
      </p>
      {!result.lines.length ? <div className="empty">Nothing to chart yet — add lines on the Month screen.</div> : (
        <>
          <div className="b-legend-row">
            <span><i className="b-swatch balance" />Balance</span>
            {bands.map((b) => <span key={b.id}><i className="b-swatch" style={{ background: b.color }} />{b.name} <span className="muted">{fmtMoney(b.total)}</span></span>)}
          </div>
          <Chart result={result} bands={bands} today={today} />
          <div className="b-chart-foot">
            <span>Start <strong>{fmtMoney(result.opening)}</strong></span>
            <span>Money in <strong>{fmtMoney(result.totals.inTotal)}</strong></span>
            <span>Out <strong>{fmtMoney(result.totals.outTotal)}</strong></span>
            <span>End <strong className={result.closing < 0 ? 'danger-text' : ''}>{fmtMoney(result.closing)}</strong></span>
            {result.low && result.low.balance < 0 && <span className="danger-text">⚠ lowest {fmtMoney(result.low.balance)} on {fmtShort(result.low.date)}</span>}
          </div>

          <div className="group-title b-gap">Spent vs planned</div>
          <div className="b-bars">
            {outLines.map((l) => {
              const st = result.stats[l.id];
              const over = st.budget != null && st.total > st.budget + 0.5;
              return (
                <div key={l.id} className="b-bar-row clickable" onClick={() => openLine(l.id)}>
                  <span className="b-bar-name">{l.name}</span>
                  <div className="b-bar-track">
                    <div className="b-bar-total" style={{ width: `${(st.total / maxLine) * 100}%` }} />
                    <div className="b-bar-actual" style={{ width: `${(st.actual / maxLine) * 100}%` }} />
                    {st.budget != null && <div className="b-bar-budget" style={{ left: `${(st.budget / maxLine) * 100}%` }} title={`Allowance ${fmtMoney(st.budget)}`} />}
                  </div>
                  <span className="b-bar-val">{fmtMoney(st.actual)} <span className="muted">of {fmtMoney(st.total)}</span>{over && <span className="danger-text"> ▲</span>}</span>
                </div>
              );
            })}
          </div>
          <div className="muted small b-bar-key"><i className="b-swatch actual" /> spent so far <i className="b-swatch total" /> forecast for the month <i className="b-swatch tick" /> allowance</div>
        </>
      )}
    </div>
  );
}
