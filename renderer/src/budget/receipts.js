// Reads receipt photos with a local Ollama vision model and matches the lines to saved goods.
import { uid } from '../util';
import { findGoodByAlias, bestGoodMatch, similarity, normName, goodPrice, round2 } from './model';

const SCHEMA = {
  type: 'object',
  properties: {
    store: { type: 'string' },
    date: { type: 'string' },
    total: { type: 'number' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          name: { type: 'string' },
          qty: { type: 'number' },
          price: { type: 'number' },
        },
        required: ['text', 'name', 'qty', 'price'],
      },
    },
  },
  required: ['store', 'date', 'total', 'items'],
};

function promptFor(budget) {
  const known = [...new Set(Object.values(budget.goods).filter((g) => !g.composite).map((g) => g.name))].sort();
  return [
    'Read this shop receipt photo. List every item that was bought, top to bottom.',
    'For each item give:',
    '- text: the item text exactly as printed on the receipt',
    '- name: what the product most likely is, in plain everyday words (expand abbreviations, e.g. "SMKD BCN RSHR" -> "Smoked bacon rashers")',
    '- qty: how many were bought (1 if not shown)',
    '- price: the total paid for that line in pounds',
    'A quantity line such as "2 @ 0.75" or "2 x £0.75" belongs to the item next to it: use it for that item\'s qty, never list it as its own item.',
    'Savings lines (e.g. "CLUBCARD SAVING -0.25", "MULTIBUY SAVING") ARE items: include them with a negative price.',
    'Do not include subtotal, total, balance due, payment, card, change, VAT or loyalty-point balance lines as items.',
    'Also give the shop name (store), the date as YYYY-MM-DD ("" if not shown) and the receipt total (0 if not shown).',
    known.length ? `\nIf an item is clearly one of these, use exactly this wording for its name: ${known.join('; ')}.` : '',
  ].join('\n');
}

// "2 @ 1.50" style lines are quantities for the item above; small models sometimes list them anyway.
const QTY_LINE = /^\s*(\d+(?:\.\d+)?)\s*(?:@|x|×)\s*£?\s*(\d+(?:\.\d+)?)\s*$/i;
function foldQuantityLines(items) {
  const out = [];
  for (const it of items) {
    const m = it.text.match(QTY_LINE);
    const prev = out[out.length - 1];
    if (m && prev) {
      const qty = Number(m[1]);
      if (Math.abs(prev.price - qty * Number(m[2])) < 0.02 || Math.abs(it.price - prev.price) < 0.02) { prev.qty = qty; continue; }
    }
    if (m && !prev) continue;
    out.push(it);
  }
  return out;
}

export async function ollamaStatus(model) {
  if (!window.api?.ollama) return { ok: false, error: 'Receipt reading works in the desktop app only.' };
  const res = await window.api.ollama.models();
  if (!res.ok) return res;
  const hasModel = res.models.some((m) => m === model || m === `${model}:latest`);
  return { ok: true, hasModel, models: res.models };
}

// Shrinks a photo so the model reads it quickly; receipts stay legible at this size.
export function downscale(file, maxSide = 1800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function readReceipt(budget, dataUrl, { onProgress, onStart } = {}) {
  const reqId = uid();
  onStart?.(reqId);
  const off = window.api.ollama.onProgress((p) => { if (p.reqId === reqId) onProgress?.(p.chars); });
  try {
    const res = await window.api.ollama.chat(reqId, {
      model: budget.settings.visionModel,
      think: false,
      format: SCHEMA,
      options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: 'user', content: promptFor(budget), images: [dataUrl.split(',')[1]] }],
    });
    if (!res.ok) throw new Error(res.error);
    let parsed;
    try { parsed = JSON.parse(res.content); } catch { throw new Error('The model replied with something that isn\'t a receipt. Try again or use a clearer photo.'); }
    return {
      store: (parsed.store || '').trim(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : '',
      total: Number(parsed.total) || 0,
      items: foldQuantityLines((parsed.items || []).filter((it) => it.text || it.name).map((it) => ({
        text: String(it.text || '').trim(),
        name: String(it.name || '').trim(),
        qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
        price: round2(Number(it.price) || 0),
      }))),
    };
  } finally {
    off();
  }
}

// Receipt text that needed expanding (abbreviations, codes) — worth asking for a proper name.
export function looksCryptic(text, guess) {
  const words = normName(text).split(' ').filter(Boolean);
  if (!words.length) return true;
  const noVowels = words.some((w) => w.length >= 3 && /^[a-z]+$/.test(w) && !/[aeiouy]/.test(w));
  return noVowels || similarity(text, guess) < 0.5;
}

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Turns what the model read into editable review rows.
export function buildRows(budget, items, defaultLineId) {
  const priced = new Set(); // offer one price update per item, even if it appears twice
  return items.map((it) => {
    // Saved receipt names are certain; the model's plain-words name is a guess to confirm.
    let good = findGoodByAlias(budget, it.text);
    let match = good ? 'alias' : null;
    if (!good && it.name) { good = findGoodByAlias(budget, it.name); if (good) match = 'model'; }
    if (!good && it.name) { good = bestGoodMatch(budget, it.name); if (good) match = 'fuzzy'; }
    const discount = it.price < 0;
    const cryptic = !good && looksCryptic(it.text, it.name);
    const unit = it.qty ? it.price / it.qty : it.price;
    return {
      key: uid(),
      text: it.text,
      guess: it.name,
      name: good ? good.name : cryptic ? '' : (it.name || titleCase(it.text)),
      qty: it.qty,
      price: it.price,
      goodId: good ? good.id : discount ? null : 'new',
      match,
      cryptic,
      oldPrice: good && !good.composite ? goodPrice(budget, good.id) : null,
      updatePrice: !!good && !good.composite && !discount && !priced.has(good.id) && Math.abs(round2(unit) - goodPrice(budget, good.id)) > 0.004 && !!priced.add(good.id),
      save: !discount,
      alias: true,
      lineId: good?.lineId || defaultLineId || null,
    };
  });
}
