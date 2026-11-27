import { useCallback, useEffect, useRef, useState } from 'react';
import { useBudget } from './BudgetApp';
import { useUI } from '../ui';
import { fmtMoney, fmtShort, round2, goodPrice } from './model';
import { MoneyInput, NumberInput, Check } from './inputs';
import { ollamaStatus, downscale, readReceipt, buildRows } from './receipts';
import { cx } from '../util';

// Outside the desktop app images only live for this session.
const memoryImages = {};
const images = {
  save: (id, url) => (window.api?.receiptImage ? window.api.receiptImage.save(id, url) : (memoryImages[id] = url)),
  load: async (id) => (window.api?.receiptImage ? window.api.receiptImage.load(id) : memoryImages[id] || null),
  remove: (id) => (window.api?.receiptImage ? window.api.receiptImage.remove(id) : delete memoryImages[id]),
};

// One receipt at a time — the GPU only fits one vision model run.
let queue = Promise.resolve();

function useImage(id) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let live = true; images.load(id).then((u) => live && setUrl(u)); return () => { live = false; }; }, [id]);
  return url;
}

function StatusChip({ status }) {
  if (!status) return <span className="chip">Checking Ollama…</span>;
  if (!status.ok) return <span className="chip danger" title={status.error}>Ollama not available</span>;
  if (!status.hasModel) return <span className="chip warn">Model not installed</span>;
  return <span className="chip ok">● Ready</span>;
}

function Review({ r, onClose }) {
  const { budget, actions, withUndo, setView, setPeriodId } = useBudget();
  const ui = useUI();
  const img = useImage(r.id);
  const [zoom, setZoom] = useState(false);
  const rows = r.rows || [];
  const setRow = (key, patch) => actions.updateReceipt(r.id, { rows: rows.map((x) => (x.key === key ? { ...x, ...patch } : x)) });
  const lines = Object.values(budget.lines).filter((l) => l.kind !== 'income').sort((a, b) => a.name.localeCompare(b.name));
  const goods = Object.values(budget.goods).filter((g) => !g.composite).sort((a, b) => a.name.localeCompare(b.name));
  const sum = round2(rows.reduce((s, x) => s + (x.price || 0), 0));
  const needName = rows.filter((x) => x.goodId === 'new' && x.save && !x.name.trim());
  const noLine = rows.filter((x) => !x.lineId);
  const filed = r.status === 'filed';

  const file = () => {
    if (needName.length) return;
    withUndo(`Filed ${r.store || 'receipt'} · ${fmtMoney(sum)}`, () => actions.fileReceipt(r.id, {
      date: r.date,
      rows: rows.map((x) => ({ ...x, name: x.name.trim() || x.guess || x.text, goodId: x.goodId === 'new' && !x.save ? null : x.goodId })),
    }));
  };

  return (
    <div className="b-review">
      <div className={cx('b-review-img', zoom && 'zoom')} onClick={() => setZoom(!zoom)} title={zoom ? 'Click to fit' : 'Click to zoom'}>
        {img ? <img src={img} alt="Receipt" /> : <div className="muted pad">Image not available</div>}
      </div>
      <div className="b-review-body">
        <div className="row b-review-head">
          <input className="b-store" value={r.store || ''} placeholder="Shop" onChange={(e) => actions.updateReceipt(r.id, { store: e.target.value })} disabled={filed} />
          <input type="date" value={r.date || ''} onChange={(e) => actions.updateReceipt(r.id, { date: e.target.value })} disabled={filed} />
          <span className="spacer" />
          <button className="btn small ghost" onClick={onClose}>Close</button>
        </div>
        <div className="row small">
          <span>Receipt total <strong>{fmtMoney(r.total)}</strong></span>
          <span className="muted">·</span>
          <span>Items add up to <strong className={Math.abs(sum - (r.total || 0)) > 0.02 && r.total ? 'warn-text' : ''}>{fmtMoney(sum)}</strong></span>
          {Math.abs(sum - (r.total || 0)) > 0.02 && r.total > 0 && <span className="warn-text">— check for a misread line</span>}
          <span className="spacer" />
          {!filed && (
            <label className="row">
              <span className="muted">All to</span>
              <select value="" onChange={(e) => e.target.value && actions.updateReceipt(r.id, { rows: rows.map((x) => ({ ...x, lineId: e.target.value })) })}>
                <option value="">choose line…</option>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <table className="b-table b-review-table">
          <thead><tr><th>On the receipt</th><th>Item</th><th>Qty</th><th>Price</th><th>Counts towards</th><th /></tr></thead>
          <tbody>
            {rows.map((x) => {
              const g = budget.goods[x.goodId];
              const unit = x.qty ? x.price / x.qty : x.price;
              const priceChanged = g && !g.composite && Math.abs(round2(unit) - goodPrice(budget, g.id)) > 0.004;
              return (
                <tr key={x.key} className={cx(x.goodId === 'new' && x.save && !x.name.trim() && 'needs-name')}>
                  <td className="mono">{x.text}{x.match === 'alias' && <span className="chip ok" title="Recognised from a saved receipt name">✓</span>}{(x.match === 'model' || x.match === 'fuzzy') && <span className="chip" title="Best guess — check it">guess</span>}</td>
                  <td>
                    <select value={x.goodId || ''} disabled={filed} onChange={(e) => {
                      const v = e.target.value || null;
                      const ng = budget.goods[v];
                      setRow(x.key, { goodId: v, match: ng ? 'manual' : null, name: ng ? ng.name : x.name || x.guess, lineId: ng?.lineId || x.lineId, updatePrice: !!ng && Math.abs(round2(unit) - goodPrice(budget, ng.id)) > 0.004 });
                    }}>
                      <option value="new">New item…</option>
                      <option value="">Not an item (just count it)</option>
                      {goods.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    {x.goodId === 'new' && (
                      <div className="b-newname">
                        <input value={x.name} disabled={filed} placeholder={x.cryptic ? `What is “${x.text}”?` : 'Name'} autoFocus={x.cryptic && !x.name} onChange={(e) => setRow(x.key, { name: e.target.value })} />
                        {x.cryptic && x.guess && !x.name && <button className="btn small ghost" onClick={() => setRow(x.key, { name: x.guess })} title="Use the model's guess">{x.guess}?</button>}
                        <Check checked={x.save} onChange={(v) => setRow(x.key, { save: v })}>save</Check>
                      </div>
                    )}
                    {g && priceChanged && !filed && (
                      <div className="b-pricechange">
                        <Check checked={x.updatePrice} onChange={(v) => setRow(x.key, { updatePrice: v })}>
                          Update price {fmtMoney(goodPrice(budget, g.id))} → <strong className={unit > goodPrice(budget, g.id) ? 'danger-text' : 'ok-text'}>{fmtMoney(unit)}</strong>
                        </Check>
                      </div>
                    )}
                    {g && x.match !== 'alias' && !filed && <div><Check checked={x.alias} onChange={(v) => setRow(x.key, { alias: v })}>Recognise “{x.text}” next time</Check></div>}
                  </td>
                  <td><NumberInput value={x.qty} min={0} step={1} disabled={filed} onCommit={(v) => setRow(x.key, { qty: v })} /></td>
                  <td><MoneyInput value={x.price} disabled={filed} onCommit={(v) => setRow(x.key, { price: v })} /></td>
                  <td>
                    <select value={x.lineId || ''} disabled={filed} onChange={(e) => setRow(x.key, { lineId: e.target.value || null })}>
                      <option value="">— not counted</option>
                      {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </td>
                  <td>{!filed && <button className="icon-btn" title="Remove misread line" onClick={() => actions.updateReceipt(r.id, { rows: rows.filter((y) => y.key !== x.key) })}>×</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filed && <button className="btn small ghost" onClick={() => actions.updateReceipt(r.id, { rows: [...rows, { key: String(Date.now()), text: '', guess: '', name: '', qty: 1, price: 0, goodId: 'new', save: true, alias: false, lineId: rows[0]?.lineId || null }] })}>+ Add a line</button>}
        {filed ? (
          <div className="b-filed">
            ✓ Filed on {fmtShort(r.date)} as {(r.entryIds || []).map((id) => budget.entries[id]).filter(Boolean).map((e) => `${fmtMoney(e.amount)} ${budget.lines[e.lineId]?.name || ''}`).join(', ') || 'nothing'}.
            <button className="btn small ghost" onClick={() => { setPeriodId(null); setView('month'); }}>See month</button>
          </div>
        ) : (
          <div className="row b-review-actions">
            {needName.length > 0 && <span className="warn-text small">Name {needName.length} item{needName.length > 1 ? 's' : ''} first (or untick “save”).</span>}
            {!needName.length && noLine.length > 0 && <span className="muted small">{noLine.length} line{noLine.length > 1 ? 's' : ''} not counted towards any budget line.</span>}
            <span className="spacer" />
            <button className="btn primary" disabled={!!needName.length || !r.date} onClick={file}>File {fmtMoney(sum)}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReceiptsView() {
  const { budget, actions, withUndo } = useBudget();
  const ui = useUI();
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState({});
  const [openId, setOpenId] = useState(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);
  const latest = useRef(budget);
  latest.current = budget;
  const model = budget.settings.visionModel;

  const check = useCallback(() => { setStatus(null); ollamaStatus(model).then(setStatus); }, [model]);
  useEffect(() => { check(); }, [check]);

  const process = useCallback((id, dataUrl) => {
    actions.updateReceipt(id, { status: 'reading', error: null });
    queue = queue.then(async () => {
      const started = Date.now();
      try {
        const out = await readReceipt(latest.current, dataUrl, { onProgress: (chars) => setProgress((p) => ({ ...p, [id]: { chars, started } })) });
        const defaultLine = Object.values(latest.current.lines).find((l) => l.mode === 'allowance' && l.kind !== 'income')?.id || null;
        actions.updateReceipt(id, { status: 'review', store: out.store, date: out.date || latest.current.receipts[id]?.date, total: out.total, rows: buildRows(latest.current, out.items, defaultLine), seconds: Math.round((Date.now() - started) / 1000) });
        setOpenId((cur) => cur || id);
      } catch (e) {
        actions.updateReceipt(id, { status: 'error', error: e.message });
      }
      setProgress((p) => { const n = { ...p }; delete n[id]; return n; });
    });
  }, [actions]);

  const addFiles = useCallback(async (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const url = await downscale(f);
        const d = f.lastModified ? new Date(f.lastModified) : new Date();
        const id = actions.addReceipt({ fileName: f.name, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` });
        await images.save(id, url);
        process(id, url);
      } catch (e) {
        ui.confirm({ title: "Couldn't add that file", message: e.message, okLabel: 'OK' });
      }
    }
  }, [actions, process, ui]);

  useEffect(() => {
    const paste = (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); addFiles(files); }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [addFiles]);

  const retry = async (id) => { const url = await images.load(id); if (url) process(id, url); };
  const receipts = Object.values(budget.receipts).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = openId && budget.receipts[openId];

  return (
    <div className="view b-receipts">
      <div className="view-head">
        <h1>Receipts</h1>
        <StatusChip status={status} />
        <span className="spacer" />
        <label className="row small muted">
          Model
          <select value={model} onChange={(e) => actions.updateSettings({ visionModel: e.target.value })}>
            {[...new Set([model, ...(status?.models || [])])].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <button className="btn small ghost" onClick={check}>Recheck</button>
      </div>
      {status && !status.ok && <div className="b-note">{status.error}</div>}
      {status?.ok && !status.hasModel && <div className="b-note">Install the vision model with <code>ollama pull {model}</code>, then press Recheck.</div>}

      {open ? <Review r={open} onClose={() => setOpenId(null)} /> : (
        <>
          <div
            className={cx('b-drop', over && 'over')}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); }}
            onClick={() => fileRef.current?.click()}
          >
            <div className="b-drop-icon">🧾</div>
            <div>Drop receipt photos here, paste one (Ctrl+V), or click to choose</div>
            <div className="muted small">Read on this computer by {model} — nothing leaves your machine. Items you've saved are recognised; new prices are offered as updates.</div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
          </div>
          <div className="b-receipt-list">
            {receipts.map((r) => {
              const p = progress[r.id];
              return (
                <div key={r.id} className={cx('b-receipt', r.status)} onClick={() => (r.status === 'review' || r.status === 'filed') && setOpenId(r.id)}>
                  <span className="b-receipt-name">{r.store || r.fileName || 'Receipt'}</span>
                  <span className="muted">{r.date ? fmtShort(r.date) : ''}</span>
                  {r.total ? <span>{fmtMoney(r.total)}</span> : null}
                  <span className="spacer" />
                  {r.status === 'reading' && <span className="chip">{p ? `Reading… ${p.chars} chars` : 'Waiting…'}</span>}
                  {r.status === 'reading' && !p && <button className="btn small ghost" onClick={(e) => { e.stopPropagation(); retry(r.id); }}>Retry</button>}
                  {r.status === 'review' && <span className="chip warn">Needs review · {(r.rows || []).length} items</span>}
                  {r.status === 'filed' && <span className="chip ok">Filed</span>}
                  {r.status === 'error' && <><span className="chip danger" title={r.error}>Failed</span><span className="muted small b-err">{r.error}</span><button className="btn small" onClick={(e) => { e.stopPropagation(); retry(r.id); }}>Retry</button></>}
                  <button className="icon-btn" title="Delete receipt" onClick={(e) => {
                    e.stopPropagation();
                    withUndo('Receipt deleted', () => actions.deleteReceipt(r.id));
                  }}>×</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
