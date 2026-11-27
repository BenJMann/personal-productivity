// Builds a self-contained, print-ready HTML page of a day or week of the calendar.
// The main process renders it off-screen and prints it to PDF (see electron/pdf.js).
import { addDays, startOfWeek, parseDay, DAY_NAMES, FULL_DAY_NAMES, MONTH_NAMES, colorFor, fmtTime } from './util';
import { taskProjectId } from './store';

const pad = (n) => String(n).padStart(2, '0');
const minutesOf = (dt) => Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
const toTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Page content box in CSS px (A4 minus 8mm margins at 96dpi).
const PAGE = {
  portrait: { w: 733, h: 1062 },
  landscape: { w: 1062, h: 733 },
};

// Same lane layout as the on-screen calendar, in minutes.
function layoutEvents(events) {
  const sorted = [...events].sort((a, b) => a.from - b.from || b.to - a.to);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((e) => e.lane + 1));
    cluster.forEach((e) => out.push({ ...e, lanes }));
    cluster = [];
  };
  for (const ev of sorted) {
    if (ev.from >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.to > ev.from).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...ev, lane });
    clusterEnd = Math.max(clusterEnd, ev.to);
  }
  if (cluster.length) flush();
  return out;
}

export function exportRange(mode, anchor) {
  const days = mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : [anchor];
  return { mode, days };
}

const longDay = (d) => {
  const dt = parseDay(d);
  return `${FULL_DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_NAMES[dt.getMonth()]} ${dt.getFullYear()}`;
};
const shortDay = (d) => {
  const dt = parseDay(d);
  return `${dt.getDate()} ${MONTH_NAMES[dt.getMonth()].slice(0, 3)} ${dt.getFullYear()}`;
};
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;

// e.g. "Calendar - Tue 2026-10-27 - exported 2026-10-27 14.32.pdf"
export function exportFilename({ mode, days }, exportedAt = new Date()) {
  const what = mode === 'week'
    ? `week ${days[0]} to ${days[days.length - 1]}`
    : `${DAY_NAMES[parseDay(days[0]).getDay()]} ${days[0]}`;
  return `Calendar - ${what} - exported ${stamp(exportedAt)}.pdf`;
}

export function buildCalendarHtml(state, { mode, days }, exportedAt = new Date()) {
  const landscape = mode === 'week';
  const page = landscape ? PAGE.landscape : PAGE.portrait;
  const tasks = Object.values(state.tasks);
  const timed = (d) => tasks.filter((t) => t.start && t.start.slice(0, 10) === d);
  const allDay = (d) => tasks.filter((t) => !t.start && t.day === d);

  // Show 08:00–18:00 at least, widened to fit every event in the range.
  const spans = days.flatMap((d) => timed(d).map((t) => {
    const from = minutesOf(t.start);
    return { from, to: Math.min(24 * 60, from + Math.max(15, t.estimate || 30)) };
  }));
  const firstHour = Math.min(8, ...spans.map((s) => Math.floor(s.from / 60)));
  const lastHour = Math.max(18, ...spans.map((s) => Math.ceil(s.to / 60)));
  const rangeMin = (lastHour - firstHour) * 60;
  const pct = (min) => `${(((min - firstHour * 60) / rangeMin) * 100).toFixed(4)}%`;

  const title = mode === 'week'
    ? `Week of ${shortDay(days[0])} – ${shortDay(days[days.length - 1])}`
    : longDay(days[0]);
  const exported = `Exported ${longDay(`${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`)} at ${pad(exportedAt.getHours())}:${pad(exportedAt.getMinutes())}`;

  const color = (t) => colorFor(taskProjectId(state, t));
  const projectName = (t) => state.projects[taskProjectId(state, t)]?.name || '';

  const column = (d) => {
    const evs = layoutEvents(timed(d).map((t) => {
      const from = minutesOf(t.start);
      return { t, from, to: Math.min(24 * 60, from + Math.max(15, t.estimate || 30)) };
    }));
    return evs.map(({ t, from, to, lane, lanes }) => {
      const proj = projectName(t);
      return `<div class="ev${t.completed ? ' done' : ''}" data-title="${esc(t.title)}" style="top:${pct(from)};height:${(((to - from) / rangeMin) * 100).toFixed(4)}%;left:calc(${(lane / lanes) * 100}% + 1px);width:calc(${100 / lanes}% - 2px);--c:${color(t)}">`
        + `<span class="ev-time">${fmtTime(t.start)}<span class="ev-end">–${toTime(to === 24 * 60 ? 0 : to)}</span></span> <span class="ev-title">${esc(t.title)}</span>`
        + (proj ? ` <span class="ev-proj">· ${esc(proj)}</span>` : '')
        + '</div>';
    }).join('');
  };

  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const cols = `44px repeat(${days.length}, minmax(0, 1fr))`;
  const anyAllDay = days.some((d) => allDay(d).length);

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #111; font-family: "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: ${page.w}px; height: ${page.h}px; display: flex; flex-direction: column; overflow: hidden; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-bottom: 6px; border-bottom: 1.5px solid #222; }
  h1 { font-size: 18px; margin: 0; font-weight: 650; }
  .stamp { font-size: 10px; color: #555; white-space: nowrap; }
  .row { display: grid; grid-template-columns: ${cols}; }
  .heads { border-bottom: 1px solid #bbb; }
  .head { padding: 5px 4px 3px; font-size: 11px; font-weight: 600; text-align: center; border-left: 1px solid #ddd; }
  .head .num { font-size: 15px; margin-left: 3px; }
  .allday { border-bottom: 1px solid #bbb; }
  .allday .label { font-size: 8.5px; color: #666; padding: 4px 4px 0 0; text-align: right; }
  .allday .cell { border-left: 1px solid #ddd; padding: 3px 2px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .chip { font-size: 9.5px; line-height: 1.25; padding: 2px 4px; border-left: 3px solid var(--c); background: color-mix(in srgb, var(--c) 18%, #fff); border-radius: 2px; overflow-wrap: anywhere; }
  .body { flex: 1; min-height: 0; position: relative; }
  .body .row { height: 100%; }
  .hours { position: relative; }
  .hour { position: absolute; right: 5px; transform: translateY(-50%); font-size: 9px; color: #666; }
  .col { position: relative; border-left: 1px solid #ddd; min-width: 0; }
  .line { position: absolute; left: 0; right: 0; border-top: 1px solid #e3e3e3; }
  .line.half { border-top-style: dotted; border-top-color: #eee; }
  .ev { position: absolute; overflow: hidden; padding: 1px 4px; font-size: ${landscape ? 9 : 11}px; line-height: 1.2; border-left: 3px solid var(--c); background: color-mix(in srgb, var(--c) 22%, #fff); border-radius: 2px; overflow-wrap: anywhere; outline: 0.5px solid #fff; }
  .ev-time { color: #444; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ev-title { font-weight: 600; }
  .ev-proj { color: #555; }
  .done .ev-title, .chip.done { text-decoration: line-through; color: #666; }
  .ev.overflow { overflow: visible; z-index: 2; height: auto !important; min-height: 0; }
</style></head>
<body><div class="page">
  <header><h1>${esc(title)}</h1><span class="stamp">${esc(exported)}</span></header>
  <div class="row heads"><div></div>${days.map((d) => {
    const dt = parseDay(d);
    return `<div class="head">${DAY_NAMES[dt.getDay()]}<span class="num">${dt.getDate()}</span></div>`;
  }).join('')}</div>
  ${anyAllDay ? `<div class="row allday"><div class="label">all day</div>${days.map((d) => `<div class="cell">${allDay(d).map((t) => `<div class="chip${t.completed ? ' done' : ''}" data-title="${esc(t.title)}" style="--c:${color(t)}">${esc(t.title)}</div>`).join('')}</div>`).join('')}</div>` : ''}
  <div class="body"><div class="row">
    <div class="hours">${hours.slice(1).map((h) => `<div class="hour" style="top:${pct(h * 60)}">${pad(h)}:00</div>`).join('')}</div>
    ${days.map((d) => `<div class="col">${hours.map((h) => `<div class="line" style="top:${pct(h * 60)}"></div><div class="line half" style="top:${pct(h * 60 + 30)}"></div>`).join('')}${column(d)}</div>`).join('')}
  </div></div>
</div>
<script>
// Shrinks any event whose text doesn't fit its box, then reports anything still clipped.
window.__fit = function () {
  var MIN = 6;
  var clipped = function (el) { return el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5; };
  var issues = [];
  var shrunk = 0;
  document.querySelectorAll('.ev').forEach(function (el) {
    var size = parseFloat(getComputedStyle(el).fontSize);
    // Drop the project label, then the end time, then shrink the text.
    ['.ev-proj', '.ev-end'].forEach(function (sel) { var x = el.querySelector(sel); if (x && clipped(el)) x.remove(); });
    while (clipped(el) && size > MIN) { size -= 0.5; el.style.fontSize = size + 'px'; shrunk++; }
    if (clipped(el)) { el.classList.add('overflow'); issues.push(el.dataset.title); }
  });
  var page = document.querySelector('.page');
  var body = document.querySelector('.body');
  if (body.clientHeight < 200 || page.scrollHeight > page.clientHeight + 0.5) issues.push('(page overflow: too many all-day items)');
  return { issues: issues, shrunk: shrunk, events: document.querySelectorAll('.ev, .chip').length };
};
</script>
</body></html>`;
}
