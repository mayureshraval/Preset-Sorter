const fs = require("fs");
const path = require("path");

const keywordsPath = path.join(__dirname, "keywords.json");
const logPath = path.join(__dirname, "move-log.json");

function getKeywords() {
  return JSON.parse(fs.readFileSync(keywordsPath));
}

function getBestCategory(filename, keywords) {
  const name = filename.toLowerCase();
  let bestCategory = null;
  let highestScore = 0;

  for (const [category, words] of Object.entries(keywords)) {
    let score = 0;

    for (const word of words) {
      const regex = new RegExp(`\\b${word}\\b`, "i");
      if (regex.test(name)) score += 2;
      else if (name.includes(word)) score += 1;
    }

    if (score > highestScore) {
      highestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory || "Misc";
}

// 🔥 PREVIEW (NO MOVING)
function previewSort(sourceDir) {
  const keywords = getKeywords();
  const results = [];

  function scan(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (file.endsWith(".fxp") || file.endsWith(".fxb")) {
        const category = getBestCategory(file, keywords);
        results.push({
          from: fullPath,
          file,
          category
        });
      }
    }
  }

  scan(sourceDir);
  return results;
}

// 🔥 REAL SORT WITH PROGRESS
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

    moved.push({
      from: item.from,
      to: dest
    });

    if (progressCallback) {
      progressCallback(Math.floor(((i + 1) / previewData.length) * 100));
    }
  }

  fs.writeFileSync(
    logPath,
    JSON.stringify({
      moved,
      createdFolders: Array.from(createdFolders)
    }, null, 2)
  );

  return moved.length;
}

// 🔥 UNDO (RESTORE + DELETE FOLDERS)
function undoLastMove() {
  if (!fs.existsSync(logPath)) return 0;

  const log = JSON.parse(fs.readFileSync(logPath));
  const { moved, createdFolders } = log;

  for (const item of moved) {
    if (fs.existsSync(item.to)) {
      fs.renameSync(item.to, item.from);
    }
  }

  for (const folder of createdFolders) {
    if (fs.existsSync(folder)) {
      const files = fs.readdirSync(folder);
      if (files.length === 0) {
        fs.rmdirSync(folder);
      }
    }
  }

  fs.unlinkSync(logPath);
  return moved.length;
}

module.exports = {
  previewSort,
  executeSort,
  undoLastMove
};