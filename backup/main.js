const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("path");
const { Worker } = require("worker_threads");
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

// 🔥 FIX: saveKeywords now calls the real sorter function (was crashing before)
ipcMain.handle("save-keywords", (event, data) => sorter.saveKeywords(data));

ipcMain.handle("open-folder", (event, folderPath) => {
  if (folderPath) shell.openPath(folderPath);
});

ipcMain.handle("undo-sort", () => sorter.undoLastMove());

// 🔥 FIX: getDefaultKeywords now calls the real sorter function (was crashing before)
ipcMain.handle("restore-defaults", () => sorter.getDefaultKeywords());

ipcMain.handle("get-version", () => app.getVersion());

ipcMain.handle("preview-sort", async (event, folderPath) => {
  return new Promise((resolve, reject) => {
    // 🔥 FIX: In a packaged asar build, __dirname points inside the archive.
    // worker_threads cannot load files from inside an asar. We must use
    // app.getAppPath() to find the real on-disk location of scan-worker.js,
    // OR we can inline the work directly in the main process to avoid the
    // worker path issue entirely. Inlining is the safest cross-platform fix.
    //
    // We keep the worker approach but resolve the path correctly:
    const workerPath = app.isPackaged
      ? path.join(process.resourcesPath, "app", "scan-worker.js")
      : path.join(__dirname, "scan-worker.js");

    const worker = new Worker(workerPath, {
      workerData: { folder: folderPath }
    });

    worker.on("message", resolve);
    worker.on("error", reject);

    // 🔥 FIX: if worker exits without messaging (crash/unhandled error),
    // reject the promise so the UI doesn't hang forever
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Scan worker exited with code ${code}`));
      }
    });
  });
});

ipcMain.handle("execute-sort", (event, folderPath, previewData) => {
  return sorter.executeSort(
    folderPath,
    previewData,
    (progress) => mainWindow.webContents.send("sort-progress", progress)
  );
});
