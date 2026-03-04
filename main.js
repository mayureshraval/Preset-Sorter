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

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const sorter = require("./sorter");
const sampleSorter = require("./sample-sorter");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    backgroundColor: "#111111",
    icon: path.join(__dirname, "assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      webSecurity: false   // allows file:// audio src from renderer
    }
  });
  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();
  createMenu();
});

function createMenu() {
  const template = [
    {
      label: "Help",
      submenu: [
        {
          label: "About Preset Sorter Pro",
          click: () => {
            const aboutWindow = new BrowserWindow({
              width: 520,
              height: 500,
              minWidth: 520,
              minHeight: 500,
              resizable: true,
              parent: mainWindow,
              modal: true,
              title: "About Preset Sorter Pro",
              webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
              }
            });
            aboutWindow.loadFile("about.html");
          }
        },
        {
          label: "Contact Support",
          click: () => {
            const subject = encodeURIComponent("Preset Sorter Pro - Support Request");
            const body = encodeURIComponent(
              `Hello,\n\nPlease describe your issue clearly below:\n\n---------------------------------------\nWhat happened:\n\nWhat were you trying to do:\n\nSteps to reproduce:\n\n---------------------------------------\n\nPlease attach screenshots if possible.\n\nApp Version: ${app.getVersion()}\nOS: ${process.platform}\n\nThank you,\n`
            );
            shell.openExternal(
              `mailto:presetsorterpro@outlook.com?subject=${subject}&body=${body}`
            );
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

ipcMain.handle("choose-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("get-keywords", () => sorter.getKeywords());

ipcMain.handle("save-keywords", (event, data) => sorter.saveKeywords(data));

ipcMain.handle("open-folder", (event, folderPath) => {
  if (folderPath) shell.openPath(folderPath);
});

ipcMain.handle("show-in-folder", (event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

ipcMain.handle("delete-file", async (event, filePath) => {
  if (!filePath) return { success: false, error: "No path provided" };
  try {
    const { fs: fsPromises } = require("fs").promises
      ? { fs: require("fs").promises }
      : { fs: require("fs/promises") };
    // Use require("fs").promises for compatibility across Node versions
    await require("fs").promises.unlink(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("undo-sort", () => sorter.undoLastMove());

ipcMain.handle("restore-defaults", () => sorter.getDefaultKeywords());

ipcMain.handle("get-supported-extensions", () => sorter.getSupportedExtensions());

ipcMain.handle("get-version", () => app.getVersion());

// ── Undo availability ──────────────────────────────────────────────────────────
ipcMain.handle("has-undo-log", async () => {
  const [presetHas, sampleHas] = await Promise.all([
    sorter.hasUndoLog(),
    sampleSorter.hasUndoLog()
  ]);
  return { preset: presetHas, sample: sampleHas };
});

// ── Soft-delete with backup (for restore support) ──────────────────────────────
// Instead of permanently deleting, we move the file to a temp backup folder.
// The renderer can then offer "Restore" within the session.
ipcMain.handle("backup-and-delete-file", async (event, filePath) => {
  if (!filePath) return { success: false, error: "No path provided" };
  try {
    const os = require("os");
    const backupDir = path.join(app.getPath("userData"), "deleted-backups");
    await require("fs").promises.mkdir(backupDir, { recursive: true });
    const timestamp = Date.now();
    const basename  = path.basename(filePath);
    const backupPath = path.join(backupDir, `${timestamp}_${basename}`);
    await require("fs").promises.rename(filePath, backupPath);
    return { success: true, backupPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("restore-backed-up-file", async (event, originalPath, backupPath) => {
  if (!originalPath || !backupPath) return { success: false, error: "Missing paths" };
  try {
    await require("fs").promises.rename(backupPath, originalPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Audio file → ArrayBuffer (for fallback decoding of unsupported formats) ───
ipcMain.handle("read-audio-file", async (event, filePath) => {
  if (!filePath) return null;
  try {
    const buf = await require("fs").promises.readFile(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch { return null; }
});

// 🔥 FIX: Removed Worker thread entirely.
// Workers cannot load modules from inside a packaged asar archive,
// which caused "Error analyzing folder" in the built exe.
// Running previewSort directly in the main process is perfectly safe —
// IPC calls are already async so the renderer UI stays responsive.
ipcMain.handle("preview-sort", async (event, folderPath) => {
  return sorter.previewSort(
    folderPath,
    (progress) => mainWindow.webContents.send("analyze-progress", progress)
  );
});

ipcMain.handle("execute-sort", (event, folderPath, previewData, keyFilter, bpmRange) => {
  return sorter.executeSort(
    folderPath,
    previewData,
    (progress) => mainWindow.webContents.send("sort-progress", progress),
    keyFilter || null,
    bpmRange  || null
  );
});

// ─── Sample Sorter IPC handlers ───────────────────────────────────────────────
ipcMain.handle("get-sample-keywords",     () => sampleSorter.getSampleKeywords());
ipcMain.handle("save-sample-keywords",    (_, data) => sampleSorter.saveSampleKeywords(data));
ipcMain.handle("restore-sample-defaults", () => sampleSorter.getDefaultSampleKeywords());
ipcMain.handle("undo-sample-sort",        () => sampleSorter.undoLastSampleMove());

ipcMain.handle("preview-sample-sort", async (_, folderPath, intelligenceMode) => {
  return sampleSorter.previewSampleSort(
    folderPath,
    intelligenceMode || false,
    (progress) => mainWindow.webContents.send("analyze-progress", progress)
  );
});

ipcMain.handle("execute-sample-sort", (_, folderPath, previewData, keyFilter, bpmRange) => {
  return sampleSorter.executeSampleSort(
    folderPath,
    previewData,
    (progress) => mainWindow.webContents.send("sort-progress", progress),
    keyFilter || null,
    bpmRange  || null
  );
});
