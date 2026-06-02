import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  db: {
    query: (sql: string, params?: any) => ipcRenderer.invoke('db:query', sql, params),
    get: (sql: string, params?: any) => ipcRenderer.invoke('db:get', sql, params),
    execute: (sql: string, params?: any) => ipcRenderer.invoke('db:execute', sql, params),
  },
  sys: {
    getPath: (name: string) => ipcRenderer.invoke('sys:get-path', name),
  },
  print: {
    silent: (deviceName?: string) => ipcRenderer.invoke('print:silent', deviceName),
    getPrinters: () => ipcRenderer.invoke('print:get-printers'),
  }
});
