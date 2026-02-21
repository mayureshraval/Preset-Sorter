const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),

  preview: (folderPath, enabledCategories) =>
    ipcRenderer.invoke("preview-sort", folderPath, enabledCategories),

  execute: (folderPath, previewData) =>
    ipcRenderer.invoke("execute-sort", folderPath, previewData),

  undo: () => ipcRenderer.invoke("undo-sort"),

  onProgress: (callback) => {
    ipcRenderer.removeAllListeners("sort-progress"); // prevent duplicate listeners
    ipcRenderer.on("sort-progress", (_, value) => callback(value));
  }
});