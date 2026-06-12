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
  // OS-encrypted secret storage (Windows DPAPI via Electron safeStorage). Used for
  // auth tokens — never localStorage. Values are sealed in the main process.
  secure: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('secure:get', key),
    set: (key: string, value: string): Promise<boolean> => ipcRenderer.invoke('secure:set', key, value),
    delete: (key: string): Promise<boolean> => ipcRenderer.invoke('secure:delete', key),
  },
  print: {
    silent: (deviceName?: string) => ipcRenderer.invoke('print:silent', deviceName),
    getPrinters: () => ipcRenderer.invoke('print:get-printers'),
  }
});
