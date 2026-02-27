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

const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { detectPresetMetadata } = require("./intelligence");

const keywordsPath = path.join(__dirname, "keywords.json");

// Lazy-require electron so this module works correctly when loaded
// from the main process in a packaged asar build.
function getLogPath() {
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "move-log.json");
  } catch {
    return path.join(os.homedir(), ".preset-sorter-move-log.json");
  }
}


async function getKeywords() {
  const data = await fs.readFile(keywordsPath, "utf-8");
  return JSON.parse(data);
}

async function saveKeywords(data) {
  await fs.writeFile(keywordsPath, JSON.stringify(data, null, 2));
}

async function getDefaultKeywords() {
  const data = await fs.readFile(keywordsPath, "utf-8");
  const keywords = JSON.parse(data);
  for (const cat of Object.keys(keywords)) {
    if (cat === "_meta") continue;
    keywords[cat].custom = [];
  }
  await saveKeywords(keywords);
  return keywords;
}

function getBestCategory(filename, keywords) {
  // Strip extension
  const nameRaw = filename.toLowerCase().replace(/\.(fxp|fxb)$/i, "");

  // Normalized version: underscores/dashes/dots → spaces, for general matching
  const name = nameRaw.replace(/[_\-\.]+/g, " ").trim();

  // Check if filename starts with a short prefix code (2–3 letters then space/underscore)
  // e.g. "WW Flute 01.fxp" → prefix = "ww"
  //      "KY Organ.fxp"    → prefix = "ky"
  //      "SYN Arco.fxp"    → prefix = "syn"
  //      "ML Glocken.fxp"  → prefix = "ml"
  const prefixMatch = name.match(/^([a-z]{2,4})\s/);
  const filePrefix = prefixMatch ? prefixMatch[1] : null;

  let bestCategory = null;
  let highestScore = 0;

  for (const [category, data] of Object.entries(keywords)) {
    if (category === "_meta") continue;

    const allWords = [
      ...(data.default || []),
      ...(data.custom || [])
    ];

    let score = 0;

    for (const word of allWords) {
      // Normalize keyword: strip surrounding underscores/spaces used as delimiters
      const w = word.toLowerCase().replace(/^[\s_]+|[\s_]+$/g, "").trim();
      if (!w) continue;

      const wordLen = w.length;
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // --- PREFIX MATCH (highest priority) ---
      // If the file starts with this keyword as a prefix code, it's a very
      // strong signal. E.g. file "WW Flute 01" → prefix "ww" matches keyword "ww"
      if (filePrefix && filePrefix === w) {
        score += 50; // dominant score — prefix codes are intentional labels
        continue;
      }

      // --- WORD BOUNDARY MATCH ---
      const boundaryRegex = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
      const matched = boundaryRegex.test(name);

      if (matched) {
        if (wordLen <= 2) {
          score += 1; // very ambiguous, barely counts
        } else if (wordLen <= 4) {
          score += 4; // short but real words: "arp", "vox", "pad", "saw"
        } else {
          score += 6 + wordLen; // long specific word, high confidence
        }
      } else if (wordLen > 5 && name.includes(w)) {
        // Partial match only for longer keywords
        score += 2;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestCategory = category;
    }
  }

  return (highestScore > 0 ? bestCategory : null) || "Misc";
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
        if (categoryNames.includes(file)) continue;
        await scan(fullPath);
      } else if (
        file.toLowerCase().endsWith(".fxp") ||
        file.toLowerCase().endsWith(".fxb")
      ) {
        const category = getBestCategory(file, keywords);
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

  const logPath = getLogPath();
  await fs.writeFile(
    logPath,
    JSON.stringify({ moved, createdFolders: Array.from(createdFolders) }, null, 2)
  );

  return moved.length;
}

async function undoLastMove() {
  const logPath = getLogPath();

  try {
    const logData = await fs.readFile(logPath, "utf-8");
    const { moved, createdFolders } = JSON.parse(logData);

    // Derive the source folder from the first moved item's original location
    // so the renderer can open it even after a New Session (currentFolder = null)
    const sourceFolder = moved.length > 0
      ? path.dirname(moved[0].from)
      : null;

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

    // Return both count and folder so renderer never depends on currentFolder
    return { count: moved.length, sourceFolder };
  } catch {
    return { count: 0, sourceFolder: null };
  }
}

module.exports = {
  previewSort,
  executeSort,
  undoLastMove,
  getKeywords,
  saveKeywords,
  getDefaultKeywords
};
