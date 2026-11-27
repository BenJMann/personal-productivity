const { BrowserWindow } = require('electron');

// Renders an HTML page off-screen, runs its text-fitting check (window.__fit), and prints it to PDF.
// Returns { data: Buffer, report: { issues, shrunk, events } }.
async function htmlToPdf(html, { landscape = false } = {}) {
  const win = new BrowserWindow({
    show: false,
    width: landscape ? 1123 : 794,
    height: landscape ? 794 : 1123,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    const report = await win.webContents.executeJavaScript('window.__fit ? window.__fit() : { issues: [], shrunk: 0, events: 0 }');
    const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, landscape });
    return { data, report };
  } finally {
    win.destroy();
  }
}

module.exports = { htmlToPdf };
