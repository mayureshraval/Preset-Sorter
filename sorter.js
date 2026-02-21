const fs = require("fs");
const path = require("path");
const { detectPresetMetadata } = require("./intelligence");

const keywordsPath = path.join(__dirname, "keywords.json");
const logPath = path.join(__dirname, "move-log.json");

// ================= SAFE DEFAULT KEYWORDS =================
function getDefaultKeywords() {
  return {
    _meta: {
      protected: [
        "Bass",
        "Lead",
        "Pluck",
        "Pad",
        "Brass",
        "Bell",
        "FX",
        "Synth",
        "Drums",
        "Arp",
        "Seq",
        "Chords",
        "Piano",
        "Strings",
        "Vocal",
        "Guitar",
        "Misc"
      ]
    },

    Bass: ["bass", "sub", "808", "low", "reese", "moog"],
    Lead: ["lead", "solo", "main", "topline"],
    Pluck: ["pluck"],
    Pad: ["pad", "atmo", "ambient", "texture", "drone"],
    Brass: ["brass", "horn", "trumpet", "trombone"],
    Bell: ["bell", "chime", "mallet", "glock"],
    FX: ["fx", "impact", "rise", "down", "sweep", "noise", "whoosh"],
    Synth: ["synth", "analog", "digital", "mono", "poly", "saw", "square"],

    Drums: [
      "drum",
      "kick",
      "snare",
      "clap",
      "hat",
      "hihat",
      "perc",
      "percussion",
      "rim",
      "tom",
      "shaker",
      "crash",
      "ride",
      "loop"
    ],

    Arp: ["arp", "arpeggio", "arpeggiated"],
    Seq: ["seq", "sequence", "step", "pattern"],
    Chords: ["chord", "stack", "harmony"],
    Piano: ["piano", "keys", "rhodes"],
    Strings: ["string", "violin", "cello", "orchestra"],
    Vocal: ["vocal", "vox", "choir", "chant"],
    Guitar: ["guitar", "strum"],
    Misc: []
  };
}

// ================= LOAD KEYWORDS SAFELY =================
function getKeywords() {
  if (!fs.existsSync(keywordsPath)) {
    const defaults = getDefaultKeywords();
    fs.writeFileSync(keywordsPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  try {
    const data = JSON.parse(fs.readFileSync(keywordsPath));

    // Ensure Misc always exists
    if (!data["Misc"]) {
      data["Misc"] = [];
      fs.writeFileSync(keywordsPath, JSON.stringify(data, null, 2));
    }

    return data;
  } catch (err) {
    const defaults = getDefaultKeywords();
    fs.writeFileSync(keywordsPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

function saveKeywords(data) {
  fs.writeFileSync(keywordsPath, JSON.stringify(data, null, 2));
}

// ================= CATEGORY SCORING =================
function getBestCategory(filename, keywords) {
  const name = filename.toLowerCase();
  let best = null;
  let scoreMax = 0;

  for (const [category, words] of Object.entries(keywords)) {

    if (category === "_meta") continue; // ignore meta

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

// ================= PREVIEW =================
function previewSort(sourceDir, enabledCategories, intelligenceMode) {
  const keywords = getKeywords();
  const results = [];

  const rootFolders = fs.readdirSync(sourceDir)
    .map(name => path.join(sourceDir, name))
    .filter(p => fs.statSync(p).isDirectory());

  rootFolders.forEach(folderPath => {
    const folderName = path.basename(folderPath);
    const files = fs.readdirSync(folderPath);

    files.forEach(file => {
      const full = path.join(folderPath, file);

      if (!file.endsWith(".fxp") && !file.endsWith(".fxb")) return;

      const category = getBestCategory(file, keywords);

      if (
        Array.isArray(enabledCategories) &&
        enabledCategories.length > 0 &&
        !enabledCategories.includes(category)
      ) return;

      const intelligence = detectPresetMetadata(file);

      results.push({
        from: full,
        file,
        category,
        parentFolder: folderName,
        intelligence
      });
    });
  });

  return { results, duplicates: [] };
}

// ================= EXECUTE SORT =================
async function executeSort(sourceDir, previewData, intelligenceMode, progressCallback) {
  const moved = [];
  const createdFolders = new Set();

  for (let i = 0; i < previewData.length; i++) {
    const item = previewData[i];
    const folderPath = path.join(
      sourceDir,
      item.parentFolder,
      item.category
    );

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
      createdFolders.add(folderPath);
    }

    let newFileName = item.file;

    if (intelligenceMode && item.intelligence) {
      const meta = item.intelligence;
      const base = path.parse(item.file).name;
      const ext = path.parse(item.file).ext;

      const parts = [base];

      if (meta.key) parts.push(meta.key.toUpperCase());
      if (meta.bpm) parts.push(meta.bpm + "BPM");
      if (meta.mood) parts.push(meta.mood);

      newFileName = parts.join("_") + ext;
    }

    const dest = path.join(folderPath, newFileName);
    fs.renameSync(item.from, dest);

    moved.push({ from: item.from, to: dest });

    if (progressCallback) {
      progressCallback(
        Math.floor(((i + 1) / previewData.length) * 100)
      );
    }
  }

  fs.writeFileSync(
    logPath,
    JSON.stringify(
      { moved, createdFolders: [...createdFolders] },
      null,
      2
    )
  );

  return moved.length;
}

// ================= UNDO =================
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