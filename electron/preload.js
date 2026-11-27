const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  dataPath: () => ipcRenderer.invoke('data:path'),
  notify: (payload) => ipcRenderer.send('notify', payload),
  focus: () => ipcRenderer.send('focus'),
  exportPdf: (payload) => ipcRenderer.invoke('calendar:exportPdf', payload),
  openExport: () => ipcRenderer.send('calendar:openExport'),
  receiptImage: {
    save: (id, dataUrl) => ipcRenderer.invoke('receipt:saveImage', { id, dataUrl }),
    load: (id) => ipcRenderer.invoke('receipt:loadImage', id),
    remove: (id) => ipcRenderer.invoke('receipt:deleteImage', id),
  },
  ollama: {
    models: () => ipcRenderer.invoke('ollama:models'),
    chat: (reqId, body) => ipcRenderer.invoke('ollama:chat', { reqId, body }),
    cancel: (reqId) => ipcRenderer.send('ollama:cancel', reqId),
    onProgress: (cb) => {
      const handler = (_e, p) => cb(p);
      ipcRenderer.on('ollama:progress', handler);
      return () => ipcRenderer.removeListener('ollama:progress', handler);
    },
  },
  onNotificationClick: (cb) => {
    const handler = (_e, taskId) => cb(taskId);
    ipcRenderer.on('notification-click', handler);
    return () => ipcRenderer.removeListener('notification-click', handler);
  },
});
