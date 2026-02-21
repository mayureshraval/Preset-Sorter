const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  preview: (path) => ipcRenderer.invoke("preview-sort", path),
  execute: (path, data) => ipcRenderer.invoke("execute-sort", path, data),
  undo: () => ipcRenderer.invoke("undo-sort"),
  onProgress: (callback) => ipcRenderer.on("sort-progress", (_, value) => callback(value))
});