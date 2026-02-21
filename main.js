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

ipcMain.handle("get-keywords", () => sorter.getKeywords());
ipcMain.handle("save-keywords", (event, data) => sorter.saveKeywords(data));


ipcMain.handle("preview-sort", async (event, folderPath, categories, intelligenceMode) => {
  console.log("Preview handler triggered");
  const result = sorter.previewSort(folderPath, categories, intelligenceMode);
  console.log("Preview finished", result.results.length);
  return result;
});
ipcMain.handle("undo-sort", () => {
  return sorter.undoLastMove();
});

ipcMain.handle("restore-defaults", () => {
  const defaults = sorter.getDefaultKeywords();
  sorter.saveKeywords(defaults);
  return defaults;
});

ipcMain.handle("execute-sort", (event, folderPath, previewData, intelligenceMode) => {
  return sorter.executeSort(folderPath, previewData, intelligenceMode,
    (progress) => mainWindow.webContents.send("sort-progress", progress)
  );

  
});