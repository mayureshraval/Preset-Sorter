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