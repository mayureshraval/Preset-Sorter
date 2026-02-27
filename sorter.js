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

// ─── Supported Preset File Extensions ────────────────────────────────────────
// Generic / cross-plugin formats
//   .fxp  — VST2 single preset (Steinberg)
//   .fxb  — VST2 preset bank (Steinberg)
//   .vstpreset — VST3 preset (Steinberg / Cubase)
// Synth-specific formats
//   .vital      — Vital (Matt Tytel)
//   .vitalbank  — Vital bank
//   .nmsv       — NI Massive (new format)
//   .ksd        — NI Massive (legacy format)
//   .nmspresetx — NI Massive X
//   .spf        — Sylenth1 preset
//   .sfz        — SFZ sampler format (wide support)
//   .adg        — Ableton Device Group / Instrument Rack
//   .adv        — Ableton Device Preset
//   .aupreset   — Apple AU preset (macOS)
//   .h2p        — u-he synths (Diva, Hive, Zebra, Repro, etc.)
//   .hypr       — u-he Hive 2 preset
//   .omnisphere — Spectrasonics Omnisphere soundbank
//   .patchwork  — Kilohearts Patchwork
//   .ksf        — Kontakt / NI sample format
//   .nki        — Native Instruments Kontakt instrument
//   .nkc        — NI Kontakt chain
//   .nkb        — NI Kontakt bank
//   .nkr        — NI Kontakt resource
//   .xpf        — Rob Papen preset (Predator, Blade, etc.)
//   .obxd       — OB-Xd preset
//   .serum      — Xfer Serum wavetable (not the .fxp preset itself, but some packs use this)
//   .phase      — Kilohearts Phase Plant preset
//   .zynaptiqs  — Zynaptiq plugins
//   .juiceduppreset — JuicedUp / GoodHertz
//   .als        — Ableton Live Set (project-level, included for completeness)
const SUPPORTED_EXTENSIONS = new Set([
  // Universal VST formats
  ".fxp", ".fxb", ".vstpreset",
  // Vital
  ".vital", ".vitalbank",
  // Native Instruments Massive / Massive X
  ".nmsv", ".ksd", ".nmspresetx",
  // Sylenth1
  ".spf",
  // u-he (Diva, Hive, Zebra, Repro, Bazille, Presswerk…)
  ".h2p", ".h2p txt", ".hypr",
  // Spectrasonics Omnisphere
  ".omnisphere",
  // Kilohearts
  ".patchwork", ".phase",
  // Native Instruments Kontakt
  ".nki", ".nkb", ".nkc", ".nkr",
  // Rob Papen (Predator 2, Blade, etc.)
  ".xpf",
  // OB-Xd
  ".obxd",
  // Ableton device presets
  ".adg", ".adv",
  // Apple AU presets
  ".aupreset",
  // SFZ sampler standard
  ".sfz"
]);

// ─── FXP/FXB Plugin ID → Synth Name ──────────────────────────────────────────
// The VST2 FXP/FXB binary header has this layout (all big-endian):
//   Offset 0  : 4 bytes  — chunkMagic  (always "CcnK")
//   Offset 4  : 4 bytes  — byteSize
//   Offset 8  : 4 bytes  — fxMagic     ("FxCk" | "FPCh" | "FxBk" | "FBCh")
//   Offset 12 : 4 bytes  — version
//   Offset 16 : 4 bytes  — fxID        ← unique 4-char plugin identifier
//
// This map covers the most common synths in the wild.
// IDs confirmed from hex analysis, KVR registry, and community research.
const FXP_PLUGIN_ID_MAP = {
  // Xfer Records
  "XfsX": "SERUM",
  "XfT2": "SERUM 2",
  // Native Instruments
  "NiMa": "MASSIVE",
  "NiMX": "MASSIVE X",
  "NIM1": "MASSIVE",
  "NiBa": "BATTERY",
  "NiKo": "KOMPLETE KONTROL",
  // LennarDigital
  "syl1": "SYLENTH1",
  // reFX
  "Vctr": "NEXUS",
  "NEXU": "NEXUS",
  "Vang": "VANGUARD",
  // Reveal Sound
  "Spir": "SPIRE",
  // Rob Papen
  "Prd2": "PREDATOR 2",
  "RPBl": "BLADE",
  "RPGo": "GO2",
  "RPPr": "PUNCH",
  // Arturia
  "AMin": "MINI V",
  "AJup": "JUPITER-8 V",
  "APro": "PROPHET V",
  "ACS8": "CS-80 V",
  "ASEM": "SEM V",
  "APig": "PIGMENTS",
  "APig": "PIGMENTS",
  // Spectrasonics
  "OMNI": "OMNISPHERE",
  "Atmo": "ATMOSPHERE",
  "Tril": "TRILIAN",
  "Styl": "STYLUS RMX",
  // u-he
  "Diva": "DIVA",
  "ZoiD": "ZEBRA 2",
  "Hive": "HIVE",
  "RePr": "REPRO-1",
  "ReP5": "REPRO-5",
  "Bazl": "BAZILLE",
  "ACpl": "ACE",
  // Tone2
  "ICEd": "ICARUS",
  "Firi": "FIREBIRD",
  "Elec": "ELECTRA 2",
  // Vengeance
  "VP1 ": "AVENGER",
  "VPS1": "AVENGER",
  // Output
  "MVMN": "MOVEMENT",
  "ANLG": "ANALOG STRINGS",
  // iZotope
  "iZtr": "TRASH 2",
  // Waldorf
  "WBlo": "BLOFELD",
  "WA2Q": "QUANTUM",
  // Camel Audio / Apple
  "CamA": "ALCHEMY",
  // TAL
  "TALn": "TAL-NOISEMAKER",
  "TALU": "TAL-U-NO-LX",
  "TALB": "TAL-BASSLINE",
  "TALR": "TAL-REVERB",
  // Sonic Charge
  "scMM": "MICROTONIC",
  // Other popular synths
  "DUNE": "DUNE 3",
  "Dn3 ": "DUNE 3",
  "Z3TA": "Z3TA+",
  "z3t2": "Z3TA+ 2",
  "Seri": "SEKTOR",
  "BiTC": "BITWIG",
  "MLTM": "MULTILAYER TM",
  "OBXd": "OB-XD",
  "Helm": "HELM",
};

/**
 * Reads the 4-char plugin ID from a VST2 .fxp or .fxb file header (offset 16).
 * Returns a human-readable synth name, or null if unrecognized or not an FXP.
 */
async function readFxpPluginId(filePath) {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".fxp") && !lower.endsWith(".fxb")) return null;

  try {
    const fd = await fs.open(filePath, "r");
    const buf = Buffer.alloc(20);
    await fd.read(buf, 0, 20, 0);
    await fd.close();

    // Validate magic header "CcnK"
    if (buf.toString("ascii", 0, 4) !== "CcnK") return null;

    // Plugin ID at offset 16, 4 bytes ASCII
    const pluginId = buf.toString("ascii", 16, 20).trim();
    return FXP_PLUGIN_ID_MAP[pluginId] || null;
  } catch {
    return null;
  }
}

function isSupportedExtension(filename) {
  const lower = filename.toLowerCase();
  for (const ext of SUPPORTED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function stripPresetExtension(filename) {
  const lower = filename.toLowerCase();
  // Sort by length descending so multi-part extensions like ".nmspresetx" match before ".x"
  const sorted = [...SUPPORTED_EXTENSIONS].sort((a, b) => b.length - a.length);
  for (const ext of sorted) {
    if (lower.endsWith(ext)) {
      return filename.slice(0, filename.length - ext.length);
    }
  }
  return filename;
}

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
  // Strip extension (supports all known preset formats)
  const nameRaw = stripPresetExtension(filename).toLowerCase();

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

  const category = (highestScore > 0 ? bestCategory : null) || "Misc";

  // Confidence: preset filenames are usually named clearly, so
  // a prefix code (50pts) should read ~80%, a long word match ~60-70%
  const SCORE_CAP = 60;
  let confidence;
  if (category === "Misc" && highestScore === 0) confidence = 0;
  else if (highestScore >= 50) confidence = Math.min(100, 85 + Math.round((highestScore - 50) / 5));
  else if (highestScore >= 25) confidence = 65 + Math.round(((highestScore - 25) / 25) * 20);
  else if (highestScore >= 10) confidence = 40 + Math.round(((highestScore - 10) / 15) * 25);
  else confidence = Math.round((highestScore / 10) * 40);

  return { category, score: highestScore, confidence };
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

async function previewSort(sourceDir, progressCallback = null) {
  const keywords = await getKeywords();
  const results = [];
  // ── Pass 1: fast count of all preset files (no metadata reads) ──────────────
  let totalFiles = 0;
  async function countFiles(dir) {
    let files;
    try { files = await fs.readdir(dir); } catch { return; }
    for (const file of files) {
      const fullPath = path.join(dir, file);
      let stat;
      try { stat = await fs.stat(fullPath); } catch { continue; }
      if (stat.isDirectory()) {
        await countFiles(fullPath);
      } else if (isSupportedExtension(file)) {
        totalFiles++;
      }
    }
  }
  await countFiles(sourceDir);

  // ── Pass 2: analyse files and emit progress after each one ──────────────────
  let processed = 0;

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
        await scan(fullPath);
      } else if (isSupportedExtension(file)) {
        const { category, confidence } = getBestCategory(file, keywords);
        const intelligence = detectPresetMetadata(file);
        const pluginName = await readFxpPluginId(fullPath);

        results.push({
          from: fullPath,
          file,
          category,
          confidence,
          intelligence,
          pluginName
        });

        processed++;
        if (progressCallback && totalFiles > 0) {
          progressCallback(Math.floor((processed / totalFiles) * 100));
        }
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
  getDefaultKeywords,
  getSupportedExtensions: () => [...SUPPORTED_EXTENSIONS]
};
