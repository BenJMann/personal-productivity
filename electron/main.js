const { app, BrowserWindow, ipcMain, Notification, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { htmlToPdf } = require('./pdf');

const DATA_FILE = () => path.join(app.getPath('userData'), 'data.json');

// Windows only shows (and routes clicks from) notifications for apps with an ID matching the installer's appId.
if (process.platform === 'win32') app.setAppUserModelId('com.personal.productivity');
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14161a',
    title: 'Personal Productivity',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('closed', () => { win = null; });

  // Keep devtools reachable for debugging.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
    }
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r') {
      win.webContents.reload();
    }
  });
}

function focusWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

ipcMain.handle('data:load', () => {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE(), 'utf8'));
  } catch (e) {
    return null;
  }
});

ipcMain.handle('data:save', (_e, data) => {
  // Write to a temp file then rename, so a crash mid-write never corrupts the data.
  const file = DATA_FILE();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
  return true;
});

ipcMain.handle('data:path', () => DATA_FILE());

let lastExport = null;
ipcMain.handle('calendar:exportPdf', async (_e, { html, filename, landscape }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export calendar to PDF',
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const { data, report } = await htmlToPdf(html, { landscape });
  fs.writeFileSync(filePath, data);
  lastExport = filePath;
  return { filePath, issues: report.issues };
});

// Only ever opens the file we just wrote.
ipcMain.on('calendar:openExport', () => { if (lastExport) shell.openPath(lastExport); });

ipcMain.on('notify', (_e, { title, body, taskId }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, urgency: 'normal' });
  n.on('click', () => {
    focusWindow();
    if (win) win.webContents.send('notification-click', taskId);
  });
  n.show();
});

ipcMain.on('focus', () => focusWindow());

// ---- Receipt photos: kept beside data.json rather than inside it. ----
const RECEIPTS_DIR = () => path.join(app.getPath('userData'), 'receipts');
const receiptFile = (id) => {
  if (!/^[a-z0-9]+$/i.test(String(id))) throw new Error('bad receipt id');
  return path.join(RECEIPTS_DIR(), `${id}.jpg`);
};

ipcMain.handle('receipt:saveImage', (_e, { id, dataUrl }) => {
  fs.mkdirSync(RECEIPTS_DIR(), { recursive: true });
  fs.writeFileSync(receiptFile(id), Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'));
  return true;
});

ipcMain.handle('receipt:loadImage', (_e, id) => {
  try { return 'data:image/jpeg;base64,' + fs.readFileSync(receiptFile(id)).toString('base64'); } catch (e) { return null; }
});

ipcMain.handle('receipt:deleteImage', (_e, id) => {
  try { fs.unlinkSync(receiptFile(id)); } catch (e) { /* already gone */ }
  return true;
});

// ---- Local Ollama (receipt reading). Only ever talks to localhost. ----
const OLLAMA = 'http://127.0.0.1:11434';
const ollamaRequests = new Map();

ipcMain.handle('ollama:models', async () => {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    const json = await res.json();
    return { ok: true, models: (json.models || []).map((m) => m.name) };
  } catch (e) {
    return { ok: false, error: 'Ollama is not running (start it with `ollama serve`).' };
  }
});

// Streams the reply so slow models don't hit HTTP timeouts, reporting progress as it goes.
ipcMain.handle('ollama:chat', async (e, { reqId, body }) => {
  const controller = new AbortController();
  ollamaRequests.set(reqId, controller);
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `Ollama error ${res.status}: ${await res.text()}` };
    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.error) return { ok: false, error: msg.error };
        content += msg.message?.content || '';
        if (!e.sender.isDestroyed()) e.sender.send('ollama:progress', { reqId, chars: content.length });
      }
    }
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Cancelled' : `Couldn't reach Ollama: ${err.message}` };
  } finally {
    ollamaRequests.delete(reqId);
  }
});

ipcMain.on('ollama:cancel', (_e, reqId) => ollamaRequests.get(reqId)?.abort());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
