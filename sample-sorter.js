// Preset Sorter Pro — Sample Sorter Engine
// Copyright (C) 2026 Mayuresh Rawal
// Licensed under GNU GPL v3

const fs   = require("fs").promises;
const path = require("path");
const os   = require("os");

const sampleKeywordsPath = path.join(__dirname, "sample-keywords.json");

// ─── Lazy electron logger path ────────────────────────────────────────────────
function getSampleLogPath() {
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "sample-move-log.json");
  } catch {
    return path.join(os.homedir(), ".preset-sorter-sample-log.json");
  }
}

// ─── Supported Audio / MIDI Extensions ────────────────────────────────────────
const SAMPLE_EXTENSIONS = new Set([
  // Lossless audio
  ".wav", ".aif", ".aiff", ".aifc", ".flac", ".alac",
  // Lossy audio
  ".mp3", ".aac", ".ogg", ".opus", ".m4a",
  // Sampler / loop formats
  ".rx2", ".rex", ".rex2",
  // MIDI
  ".mid", ".midi",
  // Stems
  ".stem.mp4"
]);

function isSampleExtension(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stem.mp4")) return true;
  for (const ext of SAMPLE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function getSampleExtension(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stem.mp4")) return ".stem.mp4";
  // Sort by length descending so longer extensions match first
  const sorted = [...SAMPLE_EXTENSIONS].sort((a, b) => b.length - a.length);
  for (const ext of sorted) {
    if (lower.endsWith(ext)) return ext;
  }
  return "";
}

function stripSampleExtension(filename) {
  const ext = getSampleExtension(filename);
  return ext ? filename.slice(0, filename.length - ext.length) : filename;
}

// ─── MIDI detection ───────────────────────────────────────────────────────────
function isMidi(filename) {
  const lower = filename.toLowerCase();
  return lower.endsWith(".mid") || lower.endsWith(".midi");
}

// ─── Keyword scoring (identical algorithm to preset sorter) ───────────────────
async function getSampleKeywords() {
  const data = await fs.readFile(sampleKeywordsPath, "utf-8");
  return JSON.parse(data);
}

async function saveSampleKeywords(data) {
  await fs.writeFile(sampleKeywordsPath, JSON.stringify(data, null, 2));
}

async function getDefaultSampleKeywords() {
  const data = await fs.readFile(sampleKeywordsPath, "utf-8");
  const kw   = JSON.parse(data);
  for (const cat of Object.keys(kw)) {
    if (cat === "_meta") continue;
    kw[cat].custom = [];
  }
  await saveSampleKeywords(kw);
  return kw;
}

function getBestSampleCategory(filename, keywords, metadata) {
  // MIDI always wins immediately
  if (isMidi(filename)) return "MIDI";

  const nameRaw  = stripSampleExtension(filename).toLowerCase();
  const name     = nameRaw.replace(/[_\-\.]+/g, " ").trim();
  // Segments split on separators - gives strong suffix/prefix signals
  // e.g. "ADORE_84_A_MAJ_BASS" -> segments include "bass" as last
  const segments = nameRaw.split(/[_\-\.]+/).map(s => s.trim()).filter(Boolean);
  const lastSeg  = segments[segments.length - 1] || "";
  const firstSeg = segments[0] || "";

  const prefixMatch = name.match(/^([a-z]{2,4})\s/);
  const filePrefix  = prefixMatch ? prefixMatch[1] : null;
  const suffixSeg   = lastSeg.toLowerCase();

  let bestCategory = null;
  let highestScore = 0;

  for (const [category, data] of Object.entries(keywords)) {
    if (category === "_meta") continue;

    const allWords = [...(data.default || []), ...(data.custom || [])];
    let score = 0;

    for (const word of allWords) {
      const w = word.toLowerCase().replace(/^[\s_]+|[\s_]+$/g, "").trim();
      if (!w) continue;

      const wordLen = w.length;
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // PREFIX CODE MATCH (e.g. "BD " -> Kick)
      if (filePrefix && filePrefix === w) { score += 60; continue; }

      // SUFFIX SEGMENT EXACT (strongest: "_BASS" at end of filename)
      if (suffixSeg === w) { score += 70; continue; }

      // SUFFIX SEGMENT CONTAINS (e.g. "_PLUCKED STRINGS" includes "strings")
      if (wordLen > 3 && suffixSeg.includes(w)) { score += 40; continue; }

      // WORD-BOUNDARY MATCH in full name
      const matched = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(name);
      if (matched) {
        if      (wordLen <= 2) score += 2;
        else if (wordLen <= 4) score += 6;
        else if (wordLen <= 7) score += 8 + wordLen;
        else                   score += 12 + wordLen;
      } else if (wordLen > 5 && name.includes(w)) {
        score += 2;
      }

      // FIRST SEGMENT BONUS
      if (wordLen >= 3 && firstSeg === w) { score += 20; }
    }

    if (score > highestScore) { highestScore = score; bestCategory = category; }
  }

  return (highestScore > 0 ? bestCategory : null) || "Misc";
}

// ─── Audio Metadata Reading ───────────────────────────────────────────────────
// Reads BPM, key, duration, sample rate from file binary headers.
// Supports: WAV (RIFF chunks + ID3 embedded), AIFF (AIFF/AIFC chunks),
//           MP3 (ID3v2 tags), FLAC (STREAMINFO block + Vorbis comments).

async function readAudioMetadata(filePath) {
  const meta = { bpm: null, key: null, durationSec: null, sampleRate: null, channels: null };
  const lower = filePath.toLowerCase();

  try {
    if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
      return await readMidiMetadata(filePath);
    } else if (lower.endsWith(".wav")) {
      return await readWavMetadata(filePath, meta);
    } else if (lower.endsWith(".aif") || lower.endsWith(".aiff") || lower.endsWith(".aifc")) {
      return await readAiffMetadata(filePath, meta);
    } else if (lower.endsWith(".mp3")) {
      return await readMp3Metadata(filePath, meta);
    } else if (lower.endsWith(".flac")) {
      return await readFlacMetadata(filePath, meta);
    }
  } catch {
    // Non-fatal — metadata is supplemental
  }

  return meta;
}

// ── WAV: read RIFF chunks for fmt (duration/rate) and id3/bext (BPM/key) ──────
async function readWavMetadata(filePath, meta) {
  const fd  = await fs.open(filePath, "r");
  const buf = Buffer.alloc(12);
  await fd.read(buf, 0, 12, 0);

  // Must start with "RIFF" and contain "WAVE"
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    await fd.close(); return meta;
  }

  const fileSize  = buf.readUInt32LE(4) + 8;
  let   offset    = 12;
  const headerBuf = Buffer.alloc(8);

  while (offset + 8 <= fileSize) {
    const r = await fd.read(headerBuf, 0, 8, offset);
    if (r.bytesRead < 8) break;

    const chunkId   = headerBuf.toString("ascii", 0, 4);
    const chunkSize = headerBuf.readUInt32LE(4);

    if (chunkId === "fmt ") {
      const fmtBuf = Buffer.alloc(Math.min(chunkSize, 16));
      await fd.read(fmtBuf, 0, fmtBuf.length, offset + 8);
      meta.sampleRate = fmtBuf.readUInt32LE(4);
      meta.channels   = fmtBuf.readUInt16LE(2);

    } else if (chunkId === "data") {
      // data chunk tells us PCM sample count → duration
      if (meta.sampleRate && meta.channels) {
        const bitsPerSample = 16; // default; refined below if fmt read more
        const bytesPerSample = (bitsPerSample / 8) * meta.channels;
        if (bytesPerSample > 0) {
          meta.durationSec = chunkSize / (meta.sampleRate * (meta.channels * 2));
        }
      }

    } else if (chunkId === "id3 " || chunkId === "ID3 " || chunkId === "id3\0") {
      // Embedded ID3 tag inside WAV
      const id3Buf = Buffer.alloc(Math.min(chunkSize, 4096));
      await fd.read(id3Buf, 0, id3Buf.length, offset + 8);
      parseId3Tags(id3Buf, meta);

    } else if (chunkId === "bext") {
      // Broadcast WAV extension — sometimes holds BPM string in description
      const bextBuf = Buffer.alloc(Math.min(chunkSize, 256));
      await fd.read(bextBuf, 0, bextBuf.length, offset + 8);
      const desc = bextBuf.toString("ascii", 0, 256).replace(/\0/g, " ");
      parseBpmFromString(desc, meta);
    }

    offset += 8 + chunkSize + (chunkSize % 2); // RIFF chunks are word-aligned
    if (offset <= 12) break; // safety
  }

  await fd.close();

  // Derive duration from fmt + data if not yet set
  if (!meta.durationSec && meta.sampleRate) {
    try {
      const stat = await fs.stat(filePath);
      // rough estimate: (fileSize - 44 header) / (sampleRate * channels * 2 bytes)
      meta.durationSec = (stat.size - 44) / (meta.sampleRate * (meta.channels || 2) * 2);
    } catch {}
  }

  return meta;
}

// ── AIFF: read AIFC/AIFF chunks for COMM (duration) and MARK/NAME/ID3 ─────────
async function readAiffMetadata(filePath, meta) {
  const fd  = await fs.open(filePath, "r");
  const buf = Buffer.alloc(12);
  await fd.read(buf, 0, 12, 0);

  const formType = buf.toString("ascii", 0, 4);
  const formSub  = buf.toString("ascii", 8, 12);
  if (formType !== "FORM" || (formSub !== "AIFF" && formSub !== "AIFC")) {
    await fd.close(); return meta;
  }

  let   offset    = 12;
  const fileSize  = buf.readUInt32BE(4) + 8;
  const hdr       = Buffer.alloc(8);

  while (offset + 8 <= fileSize) {
    const r = await fd.read(hdr, 0, 8, offset);
    if (r.bytesRead < 8) break;

    const chunkId   = hdr.toString("ascii", 0, 4);
    const chunkSize = hdr.readUInt32BE(4);

    if (chunkId === "COMM") {
      const commBuf = Buffer.alloc(Math.min(chunkSize, 26));
      await fd.read(commBuf, 0, commBuf.length, offset + 8);
      meta.channels   = commBuf.readInt16BE(0);
      const numFrames = commBuf.readUInt32BE(2);
      // Sample rate is 80-bit IEEE 754 extended at offset 8 — decode manually
      const exponent  = ((commBuf[8] & 0x7f) << 8) | commBuf[9];
      const mantissa  = commBuf.readUInt32BE(10);
      meta.sampleRate = Math.round(mantissa * Math.pow(2, exponent - 16414));
      if (meta.sampleRate > 0) meta.durationSec = numFrames / meta.sampleRate;

    } else if (chunkId === "ID3 " || chunkId === "id3 ") {
      const id3Buf = Buffer.alloc(Math.min(chunkSize, 4096));
      await fd.read(id3Buf, 0, id3Buf.length, offset + 8);
      parseId3Tags(id3Buf, meta);

    } else if (chunkId === "NAME" || chunkId === "ANNO") {
      const textBuf = Buffer.alloc(Math.min(chunkSize, 512));
      await fd.read(textBuf, 0, textBuf.length, offset + 8);
      parseBpmFromString(textBuf.toString("ascii"), meta);
    }

    offset += 8 + chunkSize + (chunkSize % 2);
    if (offset <= 12) break;
  }

  await fd.close();
  return meta;
}

// ── MP3: read ID3v2 tag from start of file ────────────────────────────────────
async function readMp3Metadata(filePath, meta) {
  const fd  = await fs.open(filePath, "r");
  const buf = Buffer.alloc(4096);
  await fd.read(buf, 0, 4096, 0);
  await fd.close();

  if (buf.toString("ascii", 0, 3) === "ID3") {
    parseId3Tags(buf, meta);
  }

  return meta;
}

// ── FLAC: read STREAMINFO block + Vorbis COMMENT block ───────────────────────
async function readFlacMetadata(filePath, meta) {
  const fd  = await fs.open(filePath, "r");
  const buf = Buffer.alloc(8192);
  await fd.read(buf, 0, 8192, 0);
  await fd.close();

  if (buf.toString("ascii", 0, 4) !== "fLaC") return meta;

  let offset = 4;
  while (offset + 4 < buf.length) {
    const blockHeader = buf[offset];
    const isLast      = !!(blockHeader & 0x80);
    const blockType   = blockHeader & 0x7f;
    const blockLen    = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
    offset += 4;

    if (blockType === 0 && offset + 18 <= buf.length) {
      // STREAMINFO
      meta.sampleRate = ((buf[offset + 10] << 12) | (buf[offset + 11] << 4) | (buf[offset + 12] >> 4)) & 0xFFFFF;
      meta.channels   = ((buf[offset + 12] >> 1) & 0x7) + 1;
      const sampleCountHigh = (buf[offset + 13] & 0x0f) * 0x100000000;
      const sampleCountLow  = buf.readUInt32BE(offset + 14);
      const totalSamples    = sampleCountHigh + sampleCountLow;
      if (meta.sampleRate > 0) meta.durationSec = totalSamples / meta.sampleRate;

    } else if (blockType === 4 && offset + 4 <= buf.length) {
      // VORBIS_COMMENT
      const vendorLen = buf.readUInt32LE(offset);
      let   vOffset   = offset + 4 + vendorLen;
      if (vOffset + 4 <= Math.min(offset + blockLen, buf.length)) {
        const commentCount = buf.readUInt32LE(vOffset);
        vOffset += 4;
        for (let i = 0; i < commentCount && vOffset + 4 < Math.min(offset + blockLen, buf.length); i++) {
          const cLen = buf.readUInt32LE(vOffset);
          vOffset += 4;
          const comment = buf.toString("utf8", vOffset, Math.min(vOffset + cLen, buf.length)).toLowerCase();
          vOffset += cLen;

          if (comment.startsWith("bpm=")) {
            meta.bpm = parseFloat(comment.slice(4)) || null;
          } else if (comment.startsWith("initialkey=") || comment.startsWith("key=")) {
            meta.key = comment.split("=")[1]?.trim() || null;
          }
        }
      }
    }

    if (isLast) break;
    offset += blockLen;
  }

  return meta;
}

// ── MIDI: read tempo from first Set Tempo event ───────────────────────────────
async function readMidiMetadata(filePath) {
  const meta = { bpm: null, key: null, durationSec: null, sampleRate: null, channels: null };
  try {
    const fd  = await fs.open(filePath, "r");
    const buf = Buffer.alloc(2048);
    await fd.read(buf, 0, 2048, 0);
    await fd.close();

    if (buf.toString("ascii", 0, 4) !== "MThd") return meta;

    // Scan for Set Tempo meta event: FF 51 03 [tt tt tt]
    for (let i = 0; i < buf.length - 6; i++) {
      if (buf[i] === 0xFF && buf[i + 1] === 0x51 && buf[i + 2] === 0x03) {
        const microseconds = (buf[i + 3] << 16) | (buf[i + 4] << 8) | buf[i + 5];
        if (microseconds > 0) meta.bpm = Math.round(60000000 / microseconds);
        break;
      }
    }
  } catch {}
  return meta;
}

// ── ID3v2 tag parser (shared by WAV embedded ID3, MP3, AIFF) ─────────────────
function parseId3Tags(buf, meta) {
  if (buf.length < 10 || buf.toString("ascii", 0, 3) !== "ID3") return;

  const majorVer = buf[3];
  // ID3v2.3 / v2.4 header size is syncsafe int at bytes 6-9
  const tagSize =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) |
    ((buf[8] & 0x7f) << 7)  |  (buf[9] & 0x7f);

  let offset = 10;
  const end  = Math.min(10 + tagSize, buf.length);

  while (offset + 10 < end) {
    const frameId   = buf.toString("ascii", offset, offset + 4);
    const frameSize = majorVer >= 4
      ? ((buf[offset + 4] & 0x7f) << 21) | ((buf[offset + 5] & 0x7f) << 14) |
        ((buf[offset + 6] & 0x7f) << 7)  |  (buf[offset + 7] & 0x7f)
      : buf.readUInt32BE(offset + 4);

    if (frameSize <= 0 || frameSize > end - offset) break;

    const frameData = buf.slice(offset + 10, offset + 10 + frameSize);

    if (frameId === "TBPM" || frameId === "TBP\0") {
      const text = frameData.toString("utf8", 1).trim();
      const n    = parseFloat(text);
      if (!isNaN(n) && n > 0) meta.bpm = n;

    } else if (frameId === "TKEY" || frameId === "TKE\0") {
      meta.key = frameData.toString("utf8", 1).trim() || null;

    } else if (frameId === "TLEN") {
      const ms = parseInt(frameData.toString("utf8", 1).trim(), 10);
      if (!isNaN(ms) && ms > 0) meta.durationSec = ms / 1000;
    }

    offset += 10 + frameSize;
  }
}

// ── Fallback: parse BPM from plain text string (bext/annotation chunks) ───────
function parseBpmFromString(str, meta) {
  if (meta.bpm) return;
  const m = str.match(/\b(\d{2,3})\s?bpm\b/i) || str.match(/\bbpm[:\s]*(\d{2,3})\b/i);
  if (m) meta.bpm = parseFloat(m[1]);
}

// ─── One-Shot vs Loop heuristic ────────────────────────────────────────────────
// Short files (<= 2 seconds) are almost certainly one-shots.
// Files > 2 s that also match one-shot keywords still get classified by score.
// We expose this as a tag so the renderer can show it, but it doesn't change
// the category — One Shot is its own category scored separately.

// ─── Intelligence: extract BPM / Key / Mood from filename ─────────────────────
// Many sample packs encode BPM and key directly in the name:
// "ADORE BPM 84 A MAJ_BASS.wav"  -> bpm=84, key="A", mood="Major"
// "Dark_Loop_120bpm_Cm.wav"       -> bpm=120, key="Cm", mood="Minor"
// "Groove 95 F#m Lead.wav"        -> bpm=95, key="F#m", mood="Minor"
function detectSampleIntelligence(filename) {
  const name = filename.toLowerCase().replace(/[_\-\.]+/g, " ");

  const result = { bpm: null, key: null, mood: null };

  // ── BPM ──
  // Matches: "BPM 84", "84bpm", "84 bpm", "(84)", "-84-", "@ 84"
  const bpmMatch = name.match(
    /\bbpm\s*(\d{2,3})\b|\b(\d{2,3})\s?bpm\b|(?:^|\s)\((\d{2,3})\)|(?:^|[\s_\-])(\d{2,3})(?:[\s_\-]|$)/
  );
  if (bpmMatch) {
    const raw = bpmMatch[1] || bpmMatch[2] || bpmMatch[3] || bpmMatch[4];
    const n   = parseInt(raw, 10);
    // Sanity check: realistic BPM range
    if (n >= 40 && n <= 250) result.bpm = n;
  }

  // ── KEY ──
  // Matches: "A MAJ", "C# MIN", "Bb", "F#m", "D minor", "G major", "Am", "Cm"
  const keyMatch = name.match(
    /\b([a-g](?:#|b|sharp|flat)?)\s*(?:(maj(?:or)?|min(?:or)?|m(?!a)))?\b/i
  );
  if (keyMatch) {
    let base = keyMatch[1].replace("sharp","#").replace("flat","b");
    base = base[0].toUpperCase() + base.slice(1);
    const mode = (keyMatch[2] || "").toLowerCase();

    if (mode.startsWith("min") || mode === "m") {
      result.key  = base + "m";
      result.mood = "Minor";
    } else if (mode.startsWith("maj")) {
      result.key  = base;
      result.mood = "Major";
    } else {
      // Bare note — check surrounding context for MAJ/MIN as separate word
      const ctxMatch = name.match(new RegExp(
        "\\b" + base.toLowerCase().replace("#","#") + "\\s+(maj|min|major|minor|m)\\b", "i"
      ));
      if (ctxMatch) {
        const ctx = ctxMatch[1].toLowerCase();
        result.mood = ctx.startsWith("maj") ? "Major" : "Minor";
        result.key  = ctx.startsWith("maj") ? base : base + "m";
      } else {
        result.key = base;
      }
    }
  }

  // ── MOOD from keywords (fallback when no key mode) ──
  if (!result.mood) {
    if (/\b(dark|grim|gloom|heavy|trap|hard|dirty|aggressive)\b/.test(name))  result.mood = "Dark";
    if (/\b(happy|bright|uplift|plucky|pop|fun|cheerful|upbeat)\b/.test(name)) result.mood = "Bright";
    if (/\b(ambient|chill|soft|warm|lush|dream|mellow|relax)\b/.test(name))   result.mood = "Chill";
    if (/\b(epic|cinematic|dramatic|tension|powerful|massive)\b/.test(name))   result.mood = "Epic";
  }

  return result;
}

function detectSampleType(filename, durationSec) {
  const name = filename.toLowerCase().replace(/[_\-\.]+/g, " ");

  if (durationSec !== null && durationSec <= 2.0) return "one-shot";

  const loopKeywords  = ["loop", "lp", "beat", "groove", "phrase", "riff", "progression"];
  const shotKeywords  = ["one shot", "oneshot", "1shot", "hit", "stab", "single", "shot", "note"];

  for (const kw of shotKeywords) if (name.includes(kw)) return "one-shot";
  for (const kw of loopKeywords)  if (name.includes(kw)) return "loop";

  if (durationSec !== null && durationSec > 2.0) return "loop";

  return "unknown";
}

// ─── Duplicate resolver (reused from preset sorter logic) ─────────────────────
async function resolveSampleDuplicate(destPath) {
  let counter = 1;
  const ext  = getSampleExtension(destPath);
  const base = destPath.slice(0, destPath.length - ext.length);

  while (true) {
    try { await fs.access(destPath); destPath = `${base} (${counter++})${ext}`; }
    catch { return destPath; }
  }
}

// ─── Preview scan ─────────────────────────────────────────────────────────────
// progressCallback(percent 0-100) is called after each file is analysed.
// We do a fast pre-count pass first so we can report real percentages.
async function previewSampleSort(sourceDir, intelligenceMode = false, progressCallback = null) {
  const keywords      = await getSampleKeywords();
  const results       = [];
  const categoryNames = Object.keys(keywords).filter(k => k !== "_meta");

  // ── Pass 1: count all sample files (fast — no metadata reads) ──────────────
  let totalFiles = 0;
  async function countFiles(dir) {
    let files;
    try { files = await fs.readdir(dir); } catch { return; }
    for (const file of files) {
      const fullPath = path.join(dir, file);
      let stat;
      try { stat = await fs.stat(fullPath); } catch { continue; }
      if (stat.isDirectory()) {
        if (!categoryNames.includes(file)) await countFiles(fullPath);
      } else if (isSampleExtension(file)) {
        totalFiles++;
      }
    }
  }
  await countFiles(sourceDir);

  // ── Pass 2: analyse files and emit progress ────────────────────────────────
  let processed = 0;

  async function scan(dir) {
    let files;
    try { files = await fs.readdir(dir); } catch { return; }

    for (const file of files) {
      const fullPath = path.join(dir, file);
      let stat;
      try { stat = await fs.stat(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        if (categoryNames.includes(file)) continue;
        await scan(fullPath);
      } else if (isSampleExtension(file)) {
        // Read binary audio metadata
        const metadata = await readAudioMetadata(fullPath);

        // Intelligence mode: fill gaps from filename parsing
        if (intelligenceMode) {
          const intel = detectSampleIntelligence(file);
          if (!metadata.bpm  && intel.bpm)  metadata.bpm  = intel.bpm;
          if (!metadata.key  && intel.key)  metadata.key  = intel.key;
          if (!metadata.mood)               metadata.mood = intel.mood;
        }

        const sampleType = detectSampleType(file, metadata.durationSec);
        const category   = getBestSampleCategory(file, keywords, metadata);

        results.push({
          from:  fullPath,
          file,
          category,
          metadata,
          sampleType,
          ext:   getSampleExtension(file)
        });

        // Emit progress after every file
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

// ─── Execute sort ─────────────────────────────────────────────────────────────
// ─── Build the destination folder name based on active key filter ─────────────
// keyFilter shape:  { mode: "all"|"major"|"minor"|"notes", notes: ["Am","C#"] }
//
// Resulting folder names:
//   mode="all"    →  "Bass Loop"           (normal, no suffix)
//   mode="major"  →  "Bass Loop [Major]"
//   mode="minor"  →  "Bass Loop [Minor]"
//   mode="notes", notes=["Am"]         → "Bass Loop [Am]"
//   mode="notes", notes=["Am","C#m"]   → "Bass Loop [Am, C#m]"
function buildDestFolderName(category, keyFilter) {
  if (!keyFilter || keyFilter.mode === "all") return category;

  let suffix = "";
  if (keyFilter.mode === "major") {
    suffix = "Major";
  } else if (keyFilter.mode === "minor") {
    suffix = "Minor";
  } else if (keyFilter.mode === "notes" && keyFilter.notes?.length) {
    suffix = keyFilter.notes.join(", ");
  }

  return suffix ? `${category} [${suffix}]` : category;
}

async function executeSampleSort(sourceDir, previewData, progressCallback, keyFilter) {
  const moved          = [];
  const createdFolders = new Set();

  for (let i = 0; i < previewData.length; i++) {
    const item       = previewData[i];
    const folderName = buildDestFolderName(item.category, keyFilter);
    const folderPath = path.join(sourceDir, folderName);

    try {
      await fs.mkdir(folderPath, { recursive: true });
      createdFolders.add(folderPath);

      let dest = path.join(folderPath, item.file);
      dest     = await resolveSampleDuplicate(dest);

      await fs.rename(item.from, dest);
      moved.push({ from: item.from, to: dest });
    } catch (err) {
      console.error("Sample move failed:", err.message);
      continue;
    }

    if (progressCallback) progressCallback(Math.floor(((i + 1) / previewData.length) * 100));
  }

  const logPath = getSampleLogPath();
  await fs.writeFile(logPath, JSON.stringify(
    { moved, createdFolders: Array.from(createdFolders) }, null, 2
  ));

  return moved.length;
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
async function undoLastSampleMove() {
  const logPath = getSampleLogPath();
  try {
    const { moved, createdFolders } = JSON.parse(await fs.readFile(logPath, "utf-8"));
    const sourceFolder = moved.length > 0 ? path.dirname(moved[0].from) : null;

    for (const item of moved) { try { await fs.rename(item.to, item.from); } catch {} }
    for (const folder of createdFolders) {
      try { if (!(await fs.readdir(folder)).length) await fs.rmdir(folder); } catch {}
    }

    await fs.unlink(logPath);
    return { count: moved.length, sourceFolder };
  } catch {
    return { count: 0, sourceFolder: null };
  }
}

module.exports = {
  previewSampleSort,
  executeSampleSort,
  undoLastSampleMove,
  getSampleKeywords,
  saveSampleKeywords,
  getDefaultSampleKeywords,
  isSampleExtension,
  getSampleExtension
};
