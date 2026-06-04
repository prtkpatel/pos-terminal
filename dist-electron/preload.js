"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  db: {
    query: (sql, params) => electron.ipcRenderer.invoke("db:query", sql, params),
    get: (sql, params) => electron.ipcRenderer.invoke("db:get", sql, params),
    execute: (sql, params) => electron.ipcRenderer.invoke("db:execute", sql, params)
  },
  sys: {
    getPath: (name) => electron.ipcRenderer.invoke("sys:get-path", name)
  }
});
