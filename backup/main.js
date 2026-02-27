const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const sorter = require("./sorter");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    backgroundColor: "#111111",
    icon: path.join(__dirname, "assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
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

ipcMain.handle("undo-sort", () => sorter.undoLastMove());

ipcMain.handle("restore-defaults", () => sorter.getDefaultKeywords());

ipcMain.handle("get-version", () => app.getVersion());

// 🔥 FIX: Removed Worker thread entirely.
// Workers cannot load modules from inside a packaged asar archive,
// which caused "Error analyzing folder" in the built exe.
// Running previewSort directly in the main process is perfectly safe —
// IPC calls are already async so the renderer UI stays responsive.
ipcMain.handle("preview-sort", async (event, folderPath) => {
  return sorter.previewSort(folderPath);
});

ipcMain.handle("execute-sort", (event, folderPath, previewData) => {
  return sorter.executeSort(
    folderPath,
    previewData,
    (progress) => mainWindow.webContents.send("sort-progress", progress)
  );
});
