const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { Worker } = require("worker_threads");
const sorter = require("./sorter");
const { Menu, shell } = require("electron");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    backgroundColor: "#111111",
    icon: path.join(__dirname, "assets/icon.ico"), // 🔥 add this
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
              `Hello,

Please describe your issue clearly below:

---------------------------------------
What happened:

What were you trying to do:

Steps to reproduce:

---------------------------------------

Please attach screenshots if possible.

App Version: ${app.getVersion()}
OS: ${process.platform}

Thank you,
`
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
  if (folderPath) {
    shell.openPath(folderPath);
  }
});

ipcMain.handle("undo-sort", () => {
  return sorter.undoLastMove();
});

ipcMain.handle("restore-defaults", () => {
  const defaults = sorter.getDefaultKeywords();
  sorter.saveKeywords(defaults);
  return defaults;
});
ipcMain.handle("get-version", () => app.getVersion());
ipcMain.handle("preview-sort", async (event, folderPath) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "scan-worker.js"), {
      workerData: { folder: folderPath }
    });

    worker.on("message", resolve);
    worker.on("error", reject);
  });
});

ipcMain.handle("execute-sort", (event, folderPath, previewData) => {
  return sorter.executeSort(
    folderPath,
    previewData,
    (progress) => mainWindow.webContents.send("sort-progress", progress)
  );
});