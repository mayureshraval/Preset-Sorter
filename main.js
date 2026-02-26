const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { Worker } = require("worker_threads");
const sorter = require("./sorter");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);

ipcMain.handle("choose-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });

  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("get-keywords", () => sorter.getKeywords());
ipcMain.handle("save-keywords", (event, data) => sorter.saveKeywords(data));



ipcMain.handle("undo-sort", () => {
  return sorter.undoLastMove();
});

ipcMain.handle("restore-defaults", () => {
  const defaults = sorter.getDefaultKeywords();
  sorter.saveKeywords(defaults);
  return defaults;
});

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