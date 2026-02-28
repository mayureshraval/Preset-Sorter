// Preset Sorter Pro
// Copyright (C) 2026 Mayuresh Rawal
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {

  openFolder: (path) =>
  ipcRenderer.invoke("open-folder", path),

  chooseFolder: () =>
    ipcRenderer.invoke("choose-folder"),
getVersion: () => ipcRenderer.invoke("get-version"),
 preview: (path, categories, intelligenceMode) =>
  ipcRenderer.invoke("preview-sort", path, categories, intelligenceMode),

 execute: (path, data, keyFilter, bpmRange) =>
    ipcRenderer.invoke("execute-sort", path, data, keyFilter, bpmRange),

  undo: () =>
    ipcRenderer.invoke("undo-sort"),

  getKeywords: () =>
    ipcRenderer.invoke("get-keywords"),

  saveKeywords: (data) =>
    ipcRenderer.invoke("save-keywords", data),

  // 🔥 ADD THIS RIGHT HERE
  restoreDefaults: () =>
    ipcRenderer.invoke("restore-defaults"),

  getSupportedExtensions: () =>
    ipcRenderer.invoke("get-supported-extensions"),

  onProgress: (callback) => {
    ipcRenderer.removeAllListeners("sort-progress");
    ipcRenderer.on("sort-progress", (_, value) => callback(value));
  },

  onAnalyzeProgress: (callback) => {
    ipcRenderer.removeAllListeners("analyze-progress");
    ipcRenderer.on("analyze-progress", (_, value) => callback(value));
  },

  // ─── Sample Sorter API ──────────────────────────────────────────────────────
  samplePreview:         (path, intelligenceMode) => ipcRenderer.invoke("preview-sample-sort", path, intelligenceMode),
  sampleExecute:         (path, data, keyFilter, bpmRange) => ipcRenderer.invoke("execute-sample-sort", path, data, keyFilter, bpmRange),
  sampleUndo:            () => ipcRenderer.invoke("undo-sample-sort"),
  getSampleKeywords:     () => ipcRenderer.invoke("get-sample-keywords"),
  saveSampleKeywords:    (data) => ipcRenderer.invoke("save-sample-keywords", data),
  restoreSampleDefaults: () => ipcRenderer.invoke("restore-sample-defaults")

});