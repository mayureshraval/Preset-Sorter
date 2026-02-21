const fs = require("fs");
const path = require("path");
const { detectPresetMetadata } = require("./intelligence");

const keywordsPath = path.join(__dirname, "keywords.json");
const logPath = path.join(__dirname, "move-log.json");

function getKeywords() {
  return JSON.parse(fs.readFileSync(keywordsPath));
}

function saveKeywords(data) {
  fs.writeFileSync(keywordsPath, JSON.stringify(data, null, 2));
}

function getBestCategory(filename, keywords) {
  const name = filename.toLowerCase();
  let best = null;
  let scoreMax = 0;

  for (const [category, words] of Object.entries(keywords)) {
    let score = 0;
    for (const word of words) {
      const regex = new RegExp(`\\b${word}\\b`, "i");
      if (regex.test(name)) score += 2;
      else if (name.includes(word)) score += 1;
    }
    if (score > scoreMax) {
      scoreMax = score;
      best = category;
    }
  }

  return best || "Misc";
}

function previewSort(sourceDir, enabledCategories) {
  const keywords = getKeywords();
  const seenNames = new Set();
  const duplicates = [];
  const results = [];

  function scan(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        scan(full);
      } else if (file.endsWith(".fxp") || file.endsWith(".fxb")) {
        const category = getBestCategory(file, keywords);

        if (enabledCategories && enabledCategories.length > 0 && !enabledCategories.includes(category)) {
          continue;
        }

        if (seenNames.has(file)) {
          duplicates.push(file);
        } else {
          seenNames.add(file);
        }

        const intelligence = detectPresetMetadata(file);

        results.push({
          from: full,
          file,
          category,
          intelligence
        });
      }
    }
  }

  scan(sourceDir);

  return { results, duplicates };
}

async function executeSort(sourceDir, previewData, progressCallback) {
  const moved = [];
  const createdFolders = new Set();

  for (let i = 0; i < previewData.length; i++) {
    const item = previewData[i];
    const folderPath = path.join(sourceDir, item.category);

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
      createdFolders.add(folderPath);
    }

    const dest = path.join(folderPath, item.file);

    fs.renameSync(item.from, dest);
    moved.push({ from: item.from, to: dest });

    if (progressCallback) {
      progressCallback(Math.floor(((i + 1) / previewData.length) * 100));
    }
  }

  fs.writeFileSync(logPath, JSON.stringify({ moved, createdFolders: [...createdFolders] }, null, 2));

  return moved.length;
}

function undoLastMove() {
  if (!fs.existsSync(logPath)) return 0;

  const log = JSON.parse(fs.readFileSync(logPath));
  const { moved, createdFolders } = log;

  moved.forEach(item => {
    if (fs.existsSync(item.to)) {
      fs.renameSync(item.to, item.from);
    }
  });

  createdFolders.forEach(folder => {
    if (fs.existsSync(folder) && fs.readdirSync(folder).length === 0) {
      fs.rmdirSync(folder);
    }
  });

  fs.unlinkSync(logPath);
  return moved.length;
}

module.exports = {
  previewSort,
  executeSort,
  undoLastMove,
  getKeywords,
  saveKeywords
};