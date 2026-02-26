const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

  openFolder: (path) =>
  ipcRenderer.invoke("open-folder", path),

  chooseFolder: () =>
    ipcRenderer.invoke("choose-folder"),

 preview: (path, categories, intelligenceMode) =>
  ipcRenderer.invoke("preview-sort", path, categories, intelligenceMode),

  execute: (path, data, intelligenceMode) =>
    ipcRenderer.invoke("execute-sort", path, data, intelligenceMode),

  undo: () =>
    ipcRenderer.invoke("undo-sort"),

  getKeywords: () =>
    ipcRenderer.invoke("get-keywords"),

  saveKeywords: (data) =>
    ipcRenderer.invoke("save-keywords", data),

  // 🔥 ADD THIS RIGHT HERE
  restoreDefaults: () =>
    ipcRenderer.invoke("restore-defaults"),

  onProgress: (callback) => {
    ipcRenderer.removeAllListeners("sort-progress");
    ipcRenderer.on("sort-progress", (_, value) => callback(value));
  }

});