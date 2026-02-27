const fs = require("fs").promises;
const path = require("path");
const { detectPresetMetadata } = require("./intelligence");
const keywordsPath = path.join(__dirname, "keywords.json");
const logPath = path.join(__dirname, "move-log.json");

async function getKeywords() {
  const data = await fs.readFile(keywordsPath, "utf-8");
  return JSON.parse(data);
}

function getBestCategory(filename, keywords) {
  const name = filename.toLowerCase();
  let bestCategory = null;
  let highestScore = 0;

  for (const [category, data] of Object.entries(keywords)) {
    if (category === "_meta") continue;

    const words = [
      ...(data.default || []),
      ...(data.custom || [])
    ];

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

async function resolveDuplicate(destPath) {
  let counter = 1;
  const ext = path.extname(destPath);
  const base = destPath.replace(ext, "");

  while (true) {
    try {
      await fs.access(destPath);
      destPath = `${base} (${counter})${ext}`;
      counter++;
    } catch {
      return destPath;
    }
  }
}

async function previewSort(sourceDir) {
  const keywords = await getKeywords();
  const results = [];
  const categoryNames = Object.keys(keywords).filter(k => k !== "_meta");

  async function scan(dir) {
    let files;

    try {
      files = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const file of files) {
      const fullPath = path.join(dir, file);

      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (categoryNames.includes(file)) continue; // ignore sorted folders
        await scan(fullPath);
      } 
      else if (
        file.toLowerCase().endsWith(".fxp") ||
        file.toLowerCase().endsWith(".fxb")
      ) {
        const category = getBestCategory(file, keywords);

        // 🔥 Intelligence metadata detection
        const intelligence = detectPresetMetadata(file);

        results.push({
          from: fullPath,
          file,
          category,
          intelligence
        });
      }
    }
  }

  await scan(sourceDir);
  return results;
}

async function executeSort(sourceDir, previewData, progressCallback) {
  const moved = [];
  const createdFolders = new Set();

  for (let i = 0; i < previewData.length; i++) {
    const item = previewData[i];
    const folderPath = path.join(sourceDir, item.category);

    try {
      await fs.mkdir(folderPath, { recursive: true });
      createdFolders.add(folderPath);

      let dest = path.join(folderPath, item.file);
      dest = await resolveDuplicate(dest);

      await fs.rename(item.from, dest);

      moved.push({ from: item.from, to: dest });
    } catch (err) {
      console.error("Move failed:", err.message);
      continue;
    }

    if (progressCallback) {
      progressCallback(Math.floor(((i + 1) / previewData.length) * 100));
    }
  }

  await fs.writeFile(
    logPath,
    JSON.stringify({ moved, createdFolders: Array.from(createdFolders) }, null, 2)
  );

  return moved.length;
}

async function undoLastMove() {
  try {
    const logData = await fs.readFile(logPath, "utf-8");
    const { moved, createdFolders } = JSON.parse(logData);

    for (const item of moved) {
      try {
        await fs.rename(item.to, item.from);
      } catch {}
    }

    for (const folder of createdFolders) {
      try {
        const files = await fs.readdir(folder);
        if (!files.length) await fs.rmdir(folder);
      } catch {}
    }

    await fs.unlink(logPath);
    return moved.length;
  } catch {
    return 0;
  }
}

module.exports = {
  previewSort,
  executeSort,
  undoLastMove,
  getKeywords
};