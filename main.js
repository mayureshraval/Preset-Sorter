const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
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

ipcMain.handle("preview-sort", async (event, folderPath) => {
  return sorter.previewSort(folderPath);
});

ipcMain.handle("execute-sort", async (event, folderPath, previewData) => {
  return await sorter.executeSort(folderPath, previewData, (progress) => {
    mainWindow.webContents.send("sort-progress", progress);
  });
});

ipcMain.handle("undo-sort", async () => {
  return sorter.undoLastMove();
});