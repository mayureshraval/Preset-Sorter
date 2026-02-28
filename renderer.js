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

let currentFolder = null;
let fullPreviewData = [];
let filteredPreviewData = [];
let intelligenceMode = false;
let isSorting = false;
let bpmRange = { min: 0, max: 300 }; // BPM slider range

// ================= THEME =================
let isDarkTheme = true; // default dark

function initTheme() {
  // Detect system preference
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  isDarkTheme = prefersDark !== false; // default to dark
  // Check localStorage override
  const saved = localStorage.getItem("themeOverride");
  if (saved === "light") isDarkTheme = false;
  if (saved === "dark") isDarkTheme = true;
  applyTheme();
  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
    if (!localStorage.getItem("themeOverride")) {
      isDarkTheme = e.matches;
      applyTheme();
    }
  });
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", isDarkTheme ? "dark" : "light");
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.textContent = isDarkTheme ? "☀️" : "🌙";
}

function toggleTheme() {
  isDarkTheme = !isDarkTheme;
  localStorage.setItem("themeOverride", isDarkTheme ? "dark" : "light");
  applyTheme();
}

// ================= APP MODE =================
// "preset" | "sample"
let appMode = "preset";
let sampleIntelligenceMode = true; // default ON — most users want metadata detection
// keyFilter drives both the preview filter AND the sort folder naming
// Shape: { mode: "all"|"major"|"minor"|"notes", notes: Set<string> }
let keyFilter = { mode: "all", notes: new Set() };

function switchMode(mode) {
  if (mode === appMode) return;
  appMode = mode;

  // Update tab buttons
  document.getElementById("tabPreset").classList.toggle("active", mode === "preset");
  document.getElementById("tabSample").classList.toggle("active", mode === "sample");

  // Show/hide sidebar panels
  document.querySelectorAll(".preset-only").forEach(el => el.classList.toggle("hidden-panel", mode !== "preset"));
  document.querySelectorAll(".sample-only").forEach(el => el.classList.toggle("hidden-panel", mode !== "sample"));

  // Reset session state when switching modes
  resetSession();
}

// ================= SAMPLE INTELLIGENCE TOGGLE =================
function onSampleIntelligenceToggle() {
  sampleIntelligenceMode = document.getElementById("sampleIntelligenceToggle").checked;
  // Re-run preview if we have a folder loaded
  if (currentFolder && appMode === "sample") {
    runPreview(currentFolder);
  }
}

// ================= KEY FILTER BAR =================
function renderKeyFilterBar() {
  const bar = document.getElementById("keyFilterBar");
  if (!bar) return;

  const hasKeyData = fullPreviewData.some(p => p.metadata?.key || p.metadata?.mood);
  if (appMode !== "sample" || !hasKeyData) {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";
  bar.innerHTML = "";

  // ── Mode buttons: All / Major / Minor ────────────────────────────────────
  const modeLabel = document.createElement("span");
  modeLabel.className = "key-filter-label";
  modeLabel.textContent = "Filter:";
  bar.appendChild(modeLabel);

  const modes = [
    { id: "all",   label: "All Keys" },
    { id: "major", label: "Major" },
    { id: "minor", label: "Minor" },
  ];

  modes.forEach(m => {
    const btn = document.createElement("button");
    btn.className = `key-filter-btn ${m.id} ${keyFilter.mode === m.id ? "active" : ""}`;
    btn.textContent = m.label;
    btn.title = m.id === "all"
      ? "Sort normally — no key suffix in folder names"
      : `Filter to ${m.label} keys — folders will be named "Category [${m.id === "major" ? "Major" : "Minor"}]"`;
    btn.onclick = () => {
      if (keyFilter.mode === m.id && m.id !== "all") {
        // Click active mode button → back to all
        keyFilter = { mode: "all", notes: new Set() };
      } else {
        keyFilter = { mode: m.id, notes: new Set() };
      }
      applyFilter();
      renderKeyFilterBar();
      updateSortFolderHint();
    };
    bar.appendChild(btn);
  });

  // ── Separator ─────────────────────────────────────────────────────────────
  const sep = document.createElement("div");
  sep.className = "key-filter-sep";
  bar.appendChild(sep);

  // ── Individual note buttons (multi-select) ────────────────────────────────
  const noteLabel = document.createElement("span");
  noteLabel.className = "key-filter-label";
  noteLabel.textContent = "Notes:";
  bar.appendChild(noteLabel);

  // ── IMPORTANT: collect keys from BPM-filtered data only ──────────────────
  // We apply the BPM filter manually here (same logic as applyFilter but key-agnostic)
  // so the note buttons only show keys that exist within the current BPM range.
  const bpmFilteredData = fullPreviewData.filter(p => {
    const bpmRaw = parseFloat(p.metadata?.bpm || 0);
    if (bpmRaw <= 0) return true; // no bpm data — always include for key scanning
    const bpmInt = Math.round(bpmRaw);
    return bpmInt >= bpmRange.min && bpmInt <= bpmRange.max;
  });

  // Collect all unique keys from BPM-filtered data
  const allKeys = [...new Set(
    bpmFilteredData
      .map(p => p.metadata?.key)
      .filter(Boolean)
      .map(k => {
        k = k.trim();
        return k[0].toUpperCase() + k.slice(1).toLowerCase();
      })
  )].sort((a, b) => {
    const noteOrder = ["C","D","E","F","G","A","B"];
    const baseA = a.replace(/[#bm]/g, "")[0] || a[0];
    const baseB = b.replace(/[#bm]/g, "")[0] || b[0];
    return noteOrder.indexOf(baseA) - noteOrder.indexOf(baseB);
  });

  // Auto-deselect any notes that are no longer in the filtered key set
  if (keyFilter.mode === "notes" && keyFilter.notes.size > 0) {
    const allKeySet = new Set(allKeys);
    for (const n of [...keyFilter.notes]) {
      if (!allKeySet.has(n)) {
        keyFilter.notes.delete(n);
      }
    }
    if (keyFilter.notes.size === 0) keyFilter.mode = "all";
  }

  if (allKeys.length === 0) {
    const noKeys = document.createElement("span");
    noKeys.style.cssText = "font-size:11px; color:#555; font-style:italic;";
    noKeys.textContent = "No key data in BPM range";
    bar.appendChild(noKeys);
    return;
  }

  allKeys.forEach(k => {
    const isActive = keyFilter.notes.has(k);
    const btn = document.createElement("button");
    btn.className = `key-filter-btn ${isActive ? "active" : ""}`;
    btn.textContent = k;

    const noteSet = new Set(keyFilter.notes);
    if (!isActive) noteSet.add(k); else noteSet.delete(k);
    const previewNotes = [...noteSet].join(", ");
    btn.title = noteSet.size === 0
      ? "Click to filter by this key"
      : `Folders will be named: "Category [${previewNotes}]"`;

    btn.onclick = () => {
      if (keyFilter.mode !== "notes") {
        keyFilter = { mode: "notes", notes: new Set() };
      }
      if (keyFilter.notes.has(k)) {
        keyFilter.notes.delete(k);
        if (keyFilter.notes.size === 0) keyFilter.mode = "all";
      } else {
        keyFilter.notes.add(k);
      }
      applyFilter();
      renderKeyFilterBar();
      updateSortFolderHint();
    };

    bar.appendChild(btn);
  });

  // ── Folder name preview hint ───────────────────────────────────────────────
  const hintEl = document.getElementById("sortFolderHint");
  if (hintEl) updateSortFolderHintEl(hintEl);
}

// ================= BPM RANGE SLIDER =================
// ── Commit helpers for the number inputs (called on change/blur/Enter) ──────
// Using commit-on-finish instead of oninput means typing "112" digit-by-digit
// doesn't trigger premature clamping. min === max is explicitly allowed so
// the user can filter to exactly one BPM value.
function commitBpmMin(raw) {
  let v = parseInt(raw);
  if (isNaN(v) || v < 0) v = 0;
  if (v > 300) v = 300;
  // Allow min === max (exact BPM filter). Only prevent min > max.
  if (v > bpmRange.max) { v = bpmRange.max; }
  bpmRange.min = v;
  const minInput = document.getElementById("bpmMinInput");
  const minSlider = document.getElementById("bpmMin");
  if (minInput) minInput.value = v;
  if (minSlider) minSlider.value = v;
  updateBpmRangeDisplay();
  applyFilter();
}

function commitBpmMax(raw) {
  let v = parseInt(raw);
  if (isNaN(v) || v < 0) v = 0;
  if (v > 300) v = 300;
  // Allow min === max. Only prevent max < min.
  if (v < bpmRange.min) { v = bpmRange.min; }
  bpmRange.max = v;
  const maxInput = document.getElementById("bpmMaxInput");
  const maxSlider = document.getElementById("bpmMax");
  if (maxInput) maxInput.value = v;
  if (maxSlider) maxSlider.value = v;
  updateBpmRangeDisplay();
  applyFilter();
}

function resetBpmSlider() {
  bpmRange = { min: 0, max: 300 };
  ["bpmMin","bpmMax","bpmMinInput","bpmMaxInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id.includes("Max") ? 300 : 0;
  });
  updateBpmRangeDisplay();
  const cont = document.getElementById("bpmSliderContainer");
  if (cont) cont.style.display = "none";
}

function updateBpmRangeDisplay() {
  const minEl = document.getElementById("bpmMinVal");
  const maxEl = document.getElementById("bpmMaxVal");
  const trackFill = document.getElementById("bpmTrackFill");
  const minInput = document.getElementById("bpmMinInput");
  const maxInput = document.getElementById("bpmMaxInput");

  if (minEl) minEl.textContent = bpmRange.min;
  if (maxEl) maxEl.textContent = bpmRange.max >= 300 ? "300+" : bpmRange.max;
  if (minInput && document.activeElement !== minInput) minInput.value = bpmRange.min;
  if (maxInput && document.activeElement !== maxInput) maxInput.value = bpmRange.max;

  if (trackFill) {
    const pctMin = (bpmRange.min / 300) * 100;
    const pctMax = (bpmRange.max / 300) * 100;
    trackFill.style.left = pctMin + "%";
    // When min === max show a small 4px dot so the track doesn't disappear
    const width = pctMax - pctMin;
    trackFill.style.width = width === 0 ? "4px" : width + "%";
  }

  // Always update the folder hint when BPM changes
  updateSortFolderHint();
}

function renderBpmSlider() {
  const container = document.getElementById("bpmSliderContainer");
  if (!container) return;

  // Check if any items have BPM data
  const hasBpm = fullPreviewData.some(p =>
    parseFloat(appMode === "sample" ? p.metadata?.bpm : p.intelligence?.bpm) > 0
  );

  if (!hasBpm || !fullPreviewData.length) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  updateBpmRangeDisplay();
}

// Shows a small hint text near the status bar describing the active key filter
function updateSortFolderHint() {
  const hintEl = document.getElementById("sortFolderHint");
  if (!hintEl) return;
  updateSortFolderHintEl(hintEl);
}

function updateSortFolderHintEl(el) {
  if (!currentFolder || !fullPreviewData.length) { el.textContent = ""; return; }
  const rootName = getSortRootPreviewName();
  el.textContent = `↳ Output: ${rootName}  /  Category  /  files`;
}

// ================= SYNTH TAG MAPPING =================
// For .fxp/.fxb files the tag comes from the binary plugin ID read in sorter.js
// (e.g. "SERUM", "MASSIVE", "SYLENTH1"). This map is used as a fallback for
// formats that have their own dedicated extension (Vital, Kontakt, etc.).

// Synth brand colors — used for both binary-identified and extension-identified synths
const SYNTH_COLORS = {
  // Identified from FXP binary header
  "SERUM":        "#00e5ff",
  "SERUM 2":      "#00b8d4",
  "MASSIVE":      "#e040fb",
  "MASSIVE X":    "#ab47bc",
  "SYLENTH1":     "#ff9800",
  "SPIRE":        "#ff7043",
  "PREDATOR 2":   "#9c27b0",
  "NEXUS":        "#42a5f5",
  "VANGUARD":     "#26c6da",
  "PIGMENTS":     "#ec407a",
  "DIVA":         "#8bc34a",
  "ZEBRA 2":      "#66bb6a",
  "HIVE":         "#7cb342",
  "REPRO-1":      "#aed581",
  "REPRO-5":      "#aed581",
  "BAZILLE":      "#81c784",
  "ACE":          "#a5d6a7",
  "OMNISPHERE":   "#ff5722",
  "ATMOSPHERE":   "#ff7043",
  "TRILIAN":      "#ff8a65",
  "STYLUS RMX":   "#ffab91",
  "ICARUS":       "#ffd54f",
  "AVENGER":      "#f44336",
  "DUNE 3":       "#26a69a",
  "OB-XD":        "#ffc107",
  "TAL-NOISEMAKER": "#78909c",
  "TAL-U-NO-LX":  "#90a4ae",
  "ALCHEMY":      "#80cbc4",
  "MOVEMENT":     "#4db6ac",
  "BLADE":        "#ba68c8",
  "HELM":         "#a5d6a7",
  "MICROTONIC":   "#ffcc80",
  "Z3TA+ 2":      "#ce93d8",
  // Extension-based fallbacks (non-FXP formats)
  "VST3":         "#78909c",
  "VITAL":        "#00bcd4",
  "VITAL BANK":   "#0097a7",
  "KONTAKT":      "#f44336",
  "PATCHWORK":    "#26c6da",
  "PHASE PLANT":  "#00acc1",
  "ROB PAPEN":    "#9c27b0",
  "ABLETON":      "#4db6ac",
  "AU":           "#90a4ae",
  "SFZ":          "#a5d6a7",
  "U-HE":         "#8bc34a",
  "HIVE 2":       "#7cb342",
};

// Extension → label for non-FXP formats (FXP is handled via binary pluginName)
const EXT_FALLBACK_LABEL = {
  ".vstpreset":  "VST3",
  ".vital":      "VITAL",
  ".vitalbank":  "VITAL BANK",
  ".nmsv":       "MASSIVE",
  ".ksd":        "MASSIVE",
  ".nmspresetx": "MASSIVE X",
  ".spf":        "SYLENTH1",
  ".h2p":        "U-HE",
  ".hypr":       "HIVE 2",
  ".omnisphere": "OMNISPHERE",
  ".patchwork":  "PATCHWORK",
  ".phase":      "PHASE PLANT",
  ".nki":        "KONTAKT",
  ".nkb":        "KONTAKT",
  ".nkc":        "KONTAKT",
  ".nkr":        "KONTAKT",
  ".xpf":        "ROB PAPEN",
  ".obxd":       "OB-XD",
  ".adg":        "ABLETON",
  ".adv":        "ABLETON",
  ".aupreset":   "AU",
  ".sfz":        "SFZ",
};

/**
 * Returns { label, color } for a preset item.
 * Priority: binary-identified pluginName > extension fallback > null
 */
function getSynthInfo(preset) {
  // 1. Use name from binary FXP header if available
  if (preset.pluginName) {
    const color = SYNTH_COLORS[preset.pluginName] || "#90a4ae";
    return { label: preset.pluginName, color };
  }

  // 2. Fall back to extension map for non-FXP formats
  const lower = preset.file.toLowerCase();
  const sorted = Object.keys(EXT_FALLBACK_LABEL).sort((a, b) => b.length - a.length);
  for (const ext of sorted) {
    if (lower.endsWith(ext)) {
      const label = EXT_FALLBACK_LABEL[ext];
      const color = SYNTH_COLORS[label] || "#90a4ae";
      return { label, color };
    }
  }

  return null;
}

/** Strips known preset extension from a filename for display. */
function stripDisplayExtension(filename) {
  const lower = filename.toLowerCase();
  const allExts = [
    ".nmspresetx", ".vitalbank", ".vstpreset", ".omnisphere",
    ".patchwork", ".aupreset", ".vital", ".nmsv", ".ksd", ".h2p",
    ".hypr", ".phase", ".nki", ".nkb", ".nkc", ".nkr", ".xpf",
    ".obxd", ".adg", ".adv", ".sfz", ".spf", ".fxp", ".fxb"
  ];
  for (const ext of allExts) {
    if (lower.endsWith(ext)) return filename.slice(0, filename.length - ext.length);
  }
  return filename;
}

/** Creates a styled synth tag <span> element for a preset item. */
function createSynthTagEl(preset) {
  const info = getSynthInfo(preset);
  if (!info) return null;
  const el = document.createElement("span");
  el.className = "synth-tag";
  el.textContent = info.label;
  el.style.cssText = `
    display: inline-block;
    margin-left: 7px;
    padding: 1px 7px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.07em;
    border-radius: 3px;
    background: ${info.color}22;
    color: ${info.color};
    border: 1px solid ${info.color}55;
    vertical-align: middle;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
  `;
  return el;
}

const statusText = document.getElementById("statusText");
const previewDiv = document.getElementById("preview");
const progressFill = document.getElementById("progressFill");

// Clears click-to-browse behaviour set by showEmptyState
function clearPreviewInteractivity() {
  previewDiv.onclick = null;
  previewDiv.onmouseenter = null;
  previewDiv.onmouseleave = null;
  previewDiv.style.cursor = "";
  previewDiv.style.borderColor = "";
}

// ================= EMPTY STATE =================
function showEmptyState(message = "Ready") {
  previewDiv.innerHTML = "";

  // The whole preview box becomes a clickable drop zone
  previewDiv.style.cursor = "pointer";

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.height = "100%";
  wrapper.style.textAlign = "center";
  wrapper.style.opacity = "0.85";
  wrapper.style.pointerEvents = "none"; // clicks pass through to previewDiv

  const icon = document.createElement("div");
  icon.textContent = "📂";
  icon.style.fontSize = "48px";
  icon.style.marginBottom = "16px";
  icon.style.transition = "transform 0.2s ease";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "17px";
  title.style.color = "var(--lavender)";
  title.textContent = "Click or drop a folder here";

  const dividerLine = document.createElement("div");
  dividerLine.style.cssText = `
    display: flex; align-items: center; gap: 10px;
    margin: 14px 0; width: 220px; opacity: 0.3;
  `;
  const line1 = document.createElement("div");
  line1.style.cssText = "flex:1; height:1px; background:currentColor;";
  const orText = document.createElement("span");
  orText.style.cssText = "font-size:11px; letter-spacing:1px;";
  orText.textContent = "OR";
  const line2 = document.createElement("div");
  line2.style.cssText = "flex:1; height:1px; background:currentColor;";
  dividerLine.appendChild(line1);
  dividerLine.appendChild(orText);
  dividerLine.appendChild(line2);

  const subtitle = document.createElement("div");
  subtitle.style.fontSize = "12px";
  subtitle.style.opacity = "0.5";
  subtitle.textContent = "Use the Select Folder button above";

  if (message !== "Ready") {
    const note = document.createElement("div");
    note.style.cssText = `
      margin-top: 18px; font-size: 12px;
      color: var(--accent); opacity: 0.8;
    `;
    note.textContent = message;
    wrapper.appendChild(icon);
    wrapper.appendChild(title);
    wrapper.appendChild(dividerLine);
    wrapper.appendChild(subtitle);
    wrapper.appendChild(note);
  } else {
    wrapper.appendChild(icon);
    wrapper.appendChild(title);
    wrapper.appendChild(dividerLine);
    wrapper.appendChild(subtitle);
  }

  previewDiv.appendChild(wrapper);
  statusText.innerText = "Ready.";

  // Click anywhere on the preview box to open folder picker
  previewDiv.onclick = async () => {
    if (isSorting) return;
    await selectFolder();
  };

  // Hover effect — lift the icon
  previewDiv.onmouseenter = () => {
    icon.style.transform = "translateY(-4px)";
    previewDiv.style.borderColor = "rgba(148, 0, 211, 0.5)";
  };
  previewDiv.onmouseleave = () => {
    icon.style.transform = "translateY(0)";
    previewDiv.style.borderColor = "";
  };
}

// ================= SORTED STATE =================
function showSortedState(sortedCount, newFolders) {
  clearPreviewInteractivity();
  previewDiv.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.height = "100%";
  wrapper.style.textAlign = "center";
  wrapper.style.overflow = "auto";
  wrapper.style.padding = "20px";

  const icon = document.createElement("div");
  icon.textContent = "✅";
  icon.style.fontSize = "40px";
  icon.style.marginBottom = "12px";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "18px";
  title.textContent = `Sorted ${sortedCount} presets successfully`;

  const subtitle = document.createElement("div");
  subtitle.style.fontSize = "13px";
  subtitle.style.opacity = "0.6";
  subtitle.style.marginTop = "6px";
  subtitle.textContent = "You can now review the sorted folders.";

  wrapper.appendChild(icon);
  wrapper.appendChild(title);
  wrapper.appendChild(subtitle);

  // New folders list with NEW badges
  if (newFolders && newFolders.length > 0) {
    const foldersLabel = document.createElement("div");
    foldersLabel.style.cssText = "margin-top:18px; margin-bottom:8px; font-size:12px; font-weight:600; color:var(--lavender); opacity:0.8; text-align:center;";
    foldersLabel.textContent = "Created Folders:";
    wrapper.appendChild(foldersLabel);

    const foldersList = document.createElement("div");
    foldersList.style.cssText = "display:flex; flex-wrap:wrap; gap:6px; justify-content:center; max-width:500px;";
    newFolders.forEach(folderPath => {
      const name = folderPath.split(/[/\\]/).pop();
      const chip = document.createElement("div");
      chip.style.cssText = `
        display:inline-flex; align-items:center; gap:6px;
        background:rgba(148,0,211,0.12); border:1px solid rgba(148,0,211,0.35);
        border-radius:8px; padding:4px 10px; font-size:12px;
      `;
      const folderIcon = document.createElement("span");
      folderIcon.textContent = "📁";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = name;
      nameSpan.style.color = "var(--lavender)";
      const newBadge = document.createElement("span");
      newBadge.textContent = "NEW";
      newBadge.style.cssText = `
        display:inline-block; padding:1px 5px; font-size:9px; font-weight:700;
        border-radius:3px; background:rgba(0,200,100,0.2); color:#30e870;
        border:1px solid rgba(0,200,100,0.4); letter-spacing:0.05em;
      `;
      chip.appendChild(folderIcon);
      chip.appendChild(nameSpan);
      chip.appendChild(newBadge);
      foldersList.appendChild(chip);
    });
    wrapper.appendChild(foldersList);
  }

  // Determine the sort root — it's the NEW_* folder (shortest path = top-level parent)
  const sortRootFolder = (newFolders && newFolders.length > 0)
    ? newFolders.reduce((shortest, p) => p.length < shortest.length ? p : shortest)
    : currentFolder;

  // Action buttons row
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex; gap:10px; margin-top:20px; flex-wrap:wrap; justify-content:center;";

  const button = document.createElement("button");
  button.textContent = "Open Sorted Folder";
  button.onclick = () => window.api.openFolder(sortRootFolder);

  const undoBtn = document.createElement("button");
  undoBtn.textContent = "↩ Undo";
  undoBtn.style.background = "#333";
  undoBtn.style.color = "#ccc";
  undoBtn.onclick = () => showUndoConfirm();

  const newSessionBtn = document.createElement("button");
  newSessionBtn.textContent = "Start New Session";
  newSessionBtn.style.background = "rgba(255,255,255,0.08)";
  newSessionBtn.style.color = "#ccc";
  newSessionBtn.onclick = () => resetSession();

  btnRow.appendChild(button);
  btnRow.appendChild(undoBtn);
  btnRow.appendChild(newSessionBtn);
  wrapper.appendChild(btnRow);
  previewDiv.appendChild(wrapper);

  statusText.innerText = `Sorted ${sortedCount} presets.`;
}

// ================= INTELLIGENCE TOGGLE =================
document.getElementById("intelligenceToggle")
  .addEventListener("change", e => {
    intelligenceMode = e.target.checked;
    renderPreview();
  });

// ================= INIT =================
initUI();

async function initUI() {
  initTheme();
  const keywords = await window.api.getKeywords();
  renderCategoryToggles(keywords);
  renderKeywordEditor(keywords);

  const sampleKeywords = await window.api.getSampleKeywords();
  renderSampleCategoryToggles(sampleKeywords);
  renderSampleKeywordEditor(sampleKeywords);

  // Default intelligence mode ON for samples
  const sampleIntelToggle = document.getElementById("sampleIntelligenceToggle");
  if (sampleIntelToggle) sampleIntelToggle.checked = true;

  showEmptyState();
}

// ================= RESIZABLE SIDEBAR =================
document.addEventListener("DOMContentLoaded", () => {
  const divider  = document.getElementById("divider");
  const hDivider = document.getElementById("hDivider");
  const sidebar  = document.getElementById("sidebar");
  const main     = document.querySelector(".main");

  if (!divider || !sidebar || !main) {
    console.error("Resize elements not found");
    return;
  }

  // ── Detect narrow (stacked) layout ───────────────────────
  function isNarrow() {
    return window.innerWidth <= 900;
  }

  // ── Restore saved widths / heights ───────────────────────
  if (!isNarrow()) {
    const savedWidth = localStorage.getItem("sidebarWidth");
    if (savedWidth) sidebar.style.width = savedWidth;
  } else {
    const savedHeight = localStorage.getItem("sidebarHeight");
    sidebar.style.width = "100%";
    if (savedHeight) sidebar.style.height = savedHeight;
  }

  // ── HORIZONTAL drag (wide layout — col-resize) ────────────
  let isDraggingH = false;

  divider.addEventListener("mousedown", (e) => {
    if (isNarrow()) return;
    e.preventDefault();
    isDraggingH = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  // ── VERTICAL drag (narrow layout — row-resize) ────────────
  let isDraggingV = false;

  if (hDivider) {
    hDivider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      isDraggingV = true;
      hDivider.classList.add("dragging");
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    });
  }

  // ── Unified mousemove ─────────────────────────────────────
  document.addEventListener("mousemove", (e) => {
    if (isDraggingH) {
      const mainRect = main.getBoundingClientRect();
      const newWidth = e.clientX - mainRect.left;
      const minWidth = 220;
      const maxWidth = mainRect.width - 220;
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        sidebar.style.width = newWidth + "px";
      }
    }

    if (isDraggingV) {
      const mainRect = main.getBoundingClientRect();
      const newHeight = e.clientY - mainRect.top;
      const minHeight = 120;
      const maxHeight = mainRect.height - 280; // leave room for preview
      if (newHeight >= minHeight && newHeight <= maxHeight) {
        sidebar.style.height = newHeight + "px";
      }
    }
  });

  // ── Unified mouseup ───────────────────────────────────────
  document.addEventListener("mouseup", () => {
    if (isDraggingH) {
      isDraggingH = false;
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
      localStorage.setItem("sidebarWidth", sidebar.style.width);
    }

    if (isDraggingV) {
      isDraggingV = false;
      if (hDivider) hDivider.classList.remove("dragging");
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
      localStorage.setItem("sidebarHeight", sidebar.style.height);
    }
  });

  // ── On window resize: swap between layouts cleanly ────────
  window.addEventListener("resize", () => {
    if (!isNarrow()) {
      // Restore width, clear any height set by vertical drag
      const w = localStorage.getItem("sidebarWidth");
      if (w) sidebar.style.width = w;
      sidebar.style.height = "";
    } else {
      // Restore height, clear any width
      const h = localStorage.getItem("sidebarHeight");
      sidebar.style.width = "100%";
      if (h) sidebar.style.height = h;
    }
  });
});


// ================= DRAG AND DROP =================
// Must run after DOM is ready. We attach to the whole window so the user
// can drop anywhere on the app, not just on the preview box.
// Electron does NOT allow reading drag-dropped file paths via the normal
// DataTransfer.files API for security reasons — we read the path from
// the dragged item's `path` property which Electron exposes on File objects.

(function initDragDrop() {
  const previewBox = document.getElementById("preview");
  let dragCounter = 0; // counter prevents flicker when dragging over child elements

  // Prevent default browser behaviour for drag events on the whole window
  window.addEventListener("dragover",  (e) => e.preventDefault());
  window.addEventListener("drop",      (e) => e.preventDefault());

  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) showDropOverlay();
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) hideDropOverlay();
  });

  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragCounter = 0;
    hideDropOverlay();

    if (isSorting) return;

    // Electron exposes the real filesystem path on the File object as .path
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;

    // Take the first item — if it's a folder its .path is the folder path
    const droppedPath = files[0].path;
    if (!droppedPath) return;

    // Verify it's actually a directory using a stat call via the folder open
    // We simply try to use it as a folder — previewSort will fail gracefully
    // if it's a file. A more robust check would require an IPC call.
    // For now, filter: if the name has an extension it's a file, skip it.
    const hasExtension = /\.[a-zA-Z0-9]{1,5}$/.test(files[0].name);
    if (hasExtension) {
      statusText.innerText = "Please drop a folder, not a file.";
      return;
    }

    currentFolder = droppedPath;
    statusText.innerText = "Analyzing...";
    progressFill.style.width = "0%";
    previewBox.innerHTML = "";

    await runPreview(currentFolder);
  });

  function showDropOverlay() {
    previewBox.classList.add("drag-over");

    // Only show overlay if there's no active preview (don't clobber it)
    if (!fullPreviewData.length) {
      previewBox.innerHTML = `
        <div class="drop-overlay">
          <div class="drop-icon">📂</div>
          <div class="drop-label">Drop folder here</div>
          <div class="drop-sub">Release to load your preset folder</div>
        </div>`;
    }
  }

  function hideDropOverlay() {
    previewBox.classList.remove("drag-over");

    // Restore empty state if we showed the overlay and there's still no data
    if (!fullPreviewData.length) {
      showEmptyState();
    }
  }
})();

// ================= CATEGORY TOGGLES =================
function renderCategoryToggles(keywords) {
  const panel = document.getElementById("categoryPanel");
  panel.innerHTML = "";

  Object.entries(keywords).forEach(([cat]) => {
    if (cat === "_meta") return;

    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" class="category-toggle" value="${cat}" checked>
      ${cat}
    `;
    panel.appendChild(label);
  });

  document.querySelectorAll(".category-toggle")
    .forEach(cb => cb.addEventListener("change", applyFilter));
}

// ================= KEYWORD EDITOR =================
function renderKeywordEditor(keywords) {
  const container = document.getElementById("keywordEditor");
  container.innerHTML = "";

  Object.entries(keywords).forEach(([category, data]) => {
    if (category === "_meta") return;

    const wrapper = document.createElement("div");
    wrapper.className = "keyword-category";

    const title = document.createElement("h4");
    title.innerText = category;
    wrapper.appendChild(title);

    const tagContainer = document.createElement("div");
    tagContainer.className = "keyword-tag-container";

    data.default.forEach(word => {
      const tag = document.createElement("div");
      tag.className = "keyword-tag default active";
      tag.innerText = word;
      tag.onclick = () => tag.classList.toggle("active");
      tagContainer.appendChild(tag);
    });

    data.custom.forEach(word => {
      const tag = document.createElement("div");
      tag.className = "keyword-tag custom active";

      const text = document.createElement("span");
      text.innerText = word;

      const remove = document.createElement("span");
      remove.innerText = "✕";
      remove.className = "remove-btn";
      remove.onclick = (e) => {
        e.stopPropagation();
        data.custom = data.custom.filter(w => w !== word);
        window.api.saveKeywords(keywords);
        renderKeywordEditor(keywords);
      };

      tag.onclick = () => tag.classList.toggle("active");
      tag.appendChild(text);
      tag.appendChild(remove);
      tagContainer.appendChild(tag);
    });

    wrapper.appendChild(tagContainer);

    const addWrapper = document.createElement("div");
    addWrapper.className = "keyword-add-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Add custom keyword...";

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        const newWord = input.value.trim().toLowerCase();
        if (!data.custom.includes(newWord)) {
          data.custom.push(newWord);
          window.api.saveKeywords(keywords);
          renderKeywordEditor(keywords);
        }
        input.value = "";
      }
    });

    addWrapper.appendChild(input);
    wrapper.appendChild(addWrapper);
    container.appendChild(wrapper);
  });
}

// ================= SELECT FOLDER =================
async function selectFolder() {
  currentFolder = await window.api.chooseFolder();
  if (!currentFolder) { showEmptyState(); return; }
  await runPreview(currentFolder);
}

async function runPreview(folder) {
  statusText.innerText = appMode === "sample" ? "Analyzing samples..." : "Analyzing presets...";
  progressFill.style.width = "0%";
  previewDiv.innerHTML = "";

  // Wire analyze progress bar for both modes
  const modeLabel = appMode === "sample" ? "samples" : "presets";
  window.api.onAnalyzeProgress(val => {
    progressFill.style.width = val + "%";
    statusText.innerText = `Analyzing ${modeLabel}... ${val}%`;
  });

  try {
    if (appMode === "sample") {
      fullPreviewData = await window.api.samplePreview(folder, sampleIntelligenceMode);
    } else {
      fullPreviewData = await window.api.preview(folder);
    }
  } catch (err) {
    console.error(err);
    progressFill.style.width = "0%";
    statusText.innerText = "Error analyzing folder.";
    return;
  }

  // Analysis complete — snap bar to 100% briefly then clear it
  progressFill.style.width = "100%";
  setTimeout(() => { progressFill.style.width = "0%"; }, 600);

  if (!fullPreviewData.length) {
    statusText.innerText = appMode === "sample" ? "No samples found." : "No presets found.";
    return;
  }

  filteredPreviewData = [...fullPreviewData];
  statusText.innerText = `${fullPreviewData.length} ${appMode === "sample" ? "samples" : "presets"} detected. Review before sorting.`;
  keyFilter = { mode: "all", notes: new Set() };
  resetBpmSlider();
  renderBpmSlider();
  renderKeyFilterBar();
  renderPreview();
}

function getEnabledCategories() {
  const selector = appMode === "sample"
    ? ".sample-category-toggle:checked"
    : ".category-toggle:checked";
  return Array.from(document.querySelectorAll(selector)).map(cb => cb.value);
}

// ================= FILTER =================
function applyFilter() {
  const enabled = getEnabledCategories();

  filteredPreviewData = !enabled.length
    ? []
    : fullPreviewData.filter(item => {
        if (!enabled.includes(item.category)) return false;

        // BPM range filter (works for both modes if bpm data available)
        // Round to integer — BPM metadata is often stored as float (e.g. 112.9)
        // and we want "112 BPM" displayed files to match a 112–112 range exactly.
        const bpmRaw = parseFloat(
          (appMode === "sample" ? item.metadata?.bpm : item.intelligence?.bpm) || 0
        );
        if (bpmRaw > 0) {
          const bpmInt = Math.round(bpmRaw);
          if (bpmInt < bpmRange.min || bpmInt > bpmRange.max) return false;
        }

        // Key filter (sample mode only, skip if mode is "all")
        if (appMode === "sample" && keyFilter.mode !== "all") {
          const rawKey  = (item.metadata?.key || "").trim();
          const mood    = item.metadata?.mood || "";
          // Normalise: "am" → "Am"
          const normKey = rawKey ? rawKey[0].toUpperCase() + rawKey.slice(1).toLowerCase() : "";
          const isMinor = normKey.endsWith("m") || mood === "Minor";
          const isMajor = !isMinor && (mood === "Major" || normKey.length > 0);

          if (keyFilter.mode === "major") {
            if (isMinor) return false;
            if (!normKey && mood !== "Major") return false;

          } else if (keyFilter.mode === "minor") {
            if (!isMinor) return false;

          } else if (keyFilter.mode === "notes") {
            // Multi-select: item must match at least one of the selected notes
            if (keyFilter.notes.size === 0) return true;
            if (!normKey) return false;
            let matched = false;
            for (const n of keyFilter.notes) {
              const normN = n[0].toUpperCase() + n.slice(1).toLowerCase();
              if (normKey === normN) { matched = true; break; }
            }
            if (!matched) return false;
          }
        }

        return true;
      });

  // After BPM filter changes, refresh the key buttons to show only keys within range
  if (appMode === "sample") renderKeyFilterBar();
  renderPreview();
}

// ================= UNDO STATE =================
function showUndoState(restoredCount, sourceFolder) {
  clearPreviewInteractivity();
  previewDiv.innerHTML = "";

  // Reset all key/metadata state so UI is clean
  fullPreviewData = [];
  filteredPreviewData = [];
  const bar = document.getElementById("keyFilterBar");
  if (bar) bar.style.display = "none";
  const hint = document.getElementById("sortFolderHint");
  if (hint) hint.textContent = "";
  keyFilter = { mode: "all", notes: new Set() };
  resetBpmSlider();

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.height = "100%";
  wrapper.style.textAlign = "center";
  wrapper.style.opacity = "0.9";

  const icon = document.createElement("div");
  icon.textContent = "↩️";
  icon.style.fontSize = "40px";
  icon.style.marginBottom = "12px";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "18px";
  title.textContent = `Undo restored ${restoredCount} files`;

  const subtitle = document.createElement("div");
  subtitle.style.fontSize = "13px";
  subtitle.style.opacity = "0.6";
  subtitle.style.marginTop = "6px";
  subtitle.textContent = "Your original folder structure has been restored. Empty sort folders were removed.";

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; justify-content:center;";

  const openBtn = document.createElement("button");
  openBtn.textContent = "Open Restored Folder";
  openBtn.onclick = () => window.api.openFolder(sourceFolder || currentFolder);

  const newSessionBtn = document.createElement("button");
  newSessionBtn.textContent = "Start New Session";
  newSessionBtn.style.background = "rgba(255,255,255,0.08)";
  newSessionBtn.style.color = "#ccc";
  newSessionBtn.onclick = () => resetSession();

  btnRow.appendChild(openBtn);
  btnRow.appendChild(newSessionBtn);

  wrapper.appendChild(icon);
  wrapper.appendChild(title);
  wrapper.appendChild(subtitle);
  wrapper.appendChild(btnRow);
  previewDiv.appendChild(wrapper);

  statusText.innerText = `Undo restored ${restoredCount} files.`;
}

// ================= PREVIEW =================
// Persisted view mode across re-renders
let currentView = "list"; // "list" | "grid" | "columns"


// ── Confidence badge — shared across both modes and all 3 views ─────────────
// Maps 0-100 confidence integer to a coloured pill badge.
// Colors: 0%=grey, 1-25%=red, 26-45%=orange, 46-65%=yellow, 66-85%=green, 86-100%=bright green
function buildConfidenceBadge(confidence) {
  if (confidence === undefined || confidence === null) return null;
  const pct = Math.max(0, Math.min(100, Math.round(confidence)));
  const el = document.createElement("span");
  el.className = "confidence-badge";
  el.textContent = pct + "%";
  el.title = `Sort confidence: ${pct}%`;

  if      (pct === 0)  el.dataset.tier = "none";
  else if (pct <= 25)  el.dataset.tier = "low";
  else if (pct <= 45)  el.dataset.tier = "medium-low";
  else if (pct <= 65)  el.dataset.tier = "medium";
  else if (pct <= 85)  el.dataset.tier = "high";
  else                 el.dataset.tier = "perfect";

  return el;
}

// ── Build sample metadata tags row (shared across all 3 view modes) ─────────
function buildSampleTagsWrap(preset) {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:inline-flex; align-items:center; gap:3px; flex-shrink:0;";

  // Duplicate warning badge (highest priority — very visible)
  if (preset.isDuplicate) {
    const dupBadge = document.createElement("span");
    dupBadge.className = "duplicate-badge";
    dupBadge.textContent = "⚠ DUP";
    dupBadge.title = "Duplicate filename detected in this folder";
    wrap.appendChild(dupBadge);
  }

  // Confidence badge — first, most prominent
  const confBadge = buildConfidenceBadge(preset.confidence);
  if (confBadge) wrap.appendChild(confBadge);

  // Extension badge
  const extBadge = document.createElement("span");
  extBadge.className = "ext-badge";
  extBadge.textContent = (preset.ext || "").replace(".", "").toUpperCase();
  wrap.appendChild(extBadge);

  // BPM chip
  if (preset.metadata?.bpm) {
    const c = document.createElement("span");
    c.className = "meta-chip";
    c.textContent = Math.round(preset.metadata.bpm) + " BPM";
    wrap.appendChild(c);
  }

  // Key chip
  if (preset.metadata?.key) {
    const c = document.createElement("span");
    c.className = "meta-chip";
    c.textContent = preset.metadata.key.toUpperCase();
    wrap.appendChild(c);
  }

  // Mood chip (when no key but mood exists)
  if (!preset.metadata?.key && preset.metadata?.mood) {
    const c = document.createElement("span");
    c.className = "meta-chip";
    c.textContent = preset.metadata.mood;
    wrap.appendChild(c);
  }

  // One-shot / Loop badge
  if (preset.sampleType && preset.sampleType !== "unknown") {
    const b = document.createElement("span");
    b.className = `sample-type-badge ${preset.sampleType}`;
    b.textContent = preset.sampleType === "one-shot" ? "ONE SHOT" : "LOOP";
    wrap.appendChild(b);
  }

  return wrap;
}


// Builds preview name for the sort root folder (mirrors the backend buildSortRootName logic)
function getSortRootPreviewName() {
  const baseName = currentFolder ? currentFolder.split(/[/\\]/).pop() : "Folder";
  const parts = [`NEW_${baseName}`];

  // Key suffix
  if (keyFilter.mode !== "all") {
    if (keyFilter.mode === "major") {
      parts.push("Major");
    } else if (keyFilter.mode === "minor") {
      parts.push("Minor");
    } else if (keyFilter.mode === "notes" && keyFilter.notes.size > 0) {
      const noteStr = [...keyFilter.notes].map(n => n.replace(/[^a-zA-Z0-9#b]/g,"")).join("_");
      if (noteStr) parts.push(noteStr);
    }
  }

  // BPM suffix
  const min = Math.round(bpmRange.min || 0);
  const max = Math.round(bpmRange.max ?? 300);
  if (min > 0 || max < 300) {
    parts.push(min === max ? `${min}BPM` : `${min}-${max}BPM`);
  }

  return parts.join("_");
}

// Returns the folder display path shown in preview — always NEW_xxx / Category
function getDisplayFolderName(category) {
  return `${getSortRootPreviewName()}  /  ${category}`;
}

function renderPreview() {
  clearPreviewInteractivity();
  previewDiv.innerHTML = "";

  if (!filteredPreviewData.length) return;

  // ── Group & sort alphabetically ──────────────────────────
  const grouped = {};
  filteredPreviewData.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });
  const sortedCategories = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  // ── Controls bar ─────────────────────────────────────────
  const controls = document.createElement("div");
  controls.className = "view-controls";

  // Left: Expand / Collapse (hidden in columns view) + duplicate warning
  const leftBtns = document.createElement("div");
  leftBtns.className = "view-controls-left";

  const expandBtn = document.createElement("button");
  expandBtn.className = "expand-collapse-btn";
  expandBtn.textContent = "Expand All";

  const collapseBtn = document.createElement("button");
  collapseBtn.className = "expand-collapse-btn";
  collapseBtn.textContent = "Collapse All";

  leftBtns.appendChild(expandBtn);
  leftBtns.appendChild(collapseBtn);

  // Duplicate count warning
  const dupCount = filteredPreviewData.filter(p => p.isDuplicate).length;
  if (dupCount > 0) {
    const dupWarn = document.createElement("span");
    dupWarn.style.cssText = `
      display:inline-flex; align-items:center; gap:4px;
      padding:3px 9px; border-radius:6px; font-size:11px; font-weight:600;
      background:rgba(255,165,0,0.15); color:#ffaa33;
      border:1px solid rgba(255,165,0,0.35);
    `;
    dupWarn.title = "These files have the same name as another file in the scan. They will be renamed with a (1), (2) suffix to avoid overwrites.";
    dupWarn.innerHTML = `⚠ ${dupCount} duplicate${dupCount > 1 ? "s" : ""}`;
    leftBtns.appendChild(dupWarn);
  }

  // Right: view switcher icons
  const rightBtns = document.createElement("div");
  rightBtns.className = "view-controls-right";

  const views = [
    { id: "list",    icon: "☰", title: "List view" },
    { id: "grid",    icon: "⊞", title: "Grid view" },
    { id: "columns", icon: "⫿", title: "Columns view" },
  ];

  const viewBtnEls = {};
  views.forEach(v => {
    const btn = document.createElement("button");
    btn.className = "view-btn" + (currentView === v.id ? " active" : "");
    btn.textContent = v.icon;
    btn.title = v.title;
    btn.onclick = () => {
      currentView = v.id;
      renderPreview();
    };
    viewBtnEls[v.id] = btn;
    rightBtns.appendChild(btn);
  });

  controls.appendChild(leftBtns);
  controls.appendChild(rightBtns);
  previewDiv.appendChild(controls);

  // In columns view hide expand/collapse (not applicable)
  if (currentView === "columns") {
    leftBtns.style.visibility = "hidden";
  }

  // ── Content container ─────────────────────────────────────
  const container = document.createElement("div");

  if (currentView === "list") {
    container.className = "view-list";
    container.style.cssText = "flex:1; overflow-y:auto;";
  } else if (currentView === "grid") {
    container.className = "view-grid";
    container.style.cssText = "flex:1; overflow-y:auto;";
  } else {
    container.className = "view-columns";
    // columns scrolls horizontally; needs explicit height
    container.style.cssText = "flex:1; min-height:0;";
  }

  previewDiv.style.display = "flex";
  previewDiv.style.flexDirection = "column";

  const folderBlocks = []; // for expand/collapse in list & grid

  sortedCategories.forEach(category => {
    const items = grouped[category];

    // ── LIST VIEW ────────────────────────────────────────────
    if (currentView === "list") {
      const block = document.createElement("div");
      block.className = "folder-block";

      const headerRow = document.createElement("div");
      headerRow.className = "folder-header-row";

      const icon = document.createElement("span");
      icon.className = "folder-icon";
      icon.textContent = "📂";

      const name = document.createElement("span");
      name.className = "folder-name";
      name.textContent = getDisplayFolderName(category);

      const count = document.createElement("span");
      count.className = "folder-count";
      count.textContent = items.length;

      const chevron = document.createElement("span");
      chevron.className = "folder-chevron";
      chevron.textContent = "▼";

      headerRow.appendChild(icon);
      headerRow.appendChild(name);
      headerRow.appendChild(count);
      headerRow.appendChild(chevron);

      const filesDiv = document.createElement("div");
      filesDiv.className = "folder-files";

      items.forEach(preset => {
        const row = document.createElement("div");
        row.className = "file-row";
        row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:4px;";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = appMode === "sample" ? stripDisplayExtension(preset.file) : preset.file;
        nameSpan.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
        row.appendChild(nameSpan);

        if (appMode === "sample") {
          const tagsWrap = buildSampleTagsWrap(preset);
          row.appendChild(tagsWrap);
        } else {
          const tagsWrap = document.createElement("span");
          tagsWrap.style.cssText = "display:inline-flex; align-items:center; gap:3px; flex-shrink:0;";
          if (preset.isDuplicate) {
            const dupBadge = document.createElement("span");
            dupBadge.className = "duplicate-badge";
            dupBadge.textContent = "⚠ DUP";
            dupBadge.title = "Duplicate filename detected";
            tagsWrap.appendChild(dupBadge);
          }
          const confP = buildConfidenceBadge(preset.confidence);
          if (confP) tagsWrap.appendChild(confP);
          const tagEl = createSynthTagEl(preset);
          if (tagEl) tagsWrap.appendChild(tagEl);
          if (tagsWrap.children.length) row.appendChild(tagsWrap);
        }
        filesDiv.appendChild(row);
      });

      let open = true;
      headerRow.onclick = () => {
        open = !open;
        filesDiv.style.display = open ? "block" : "none";
        icon.textContent = open ? "📂" : "📁";
        chevron.style.transform = open ? "rotate(0deg)" : "rotate(-90deg)";
      };

      block.appendChild(headerRow);
      block.appendChild(filesDiv);
      container.appendChild(block);
      folderBlocks.push({ icon, chevron, filesDiv, getOpen: () => open, setOpen: (v) => { open = v; } });

    // ── GRID VIEW ────────────────────────────────────────────
    } else if (currentView === "grid") {
      const block = document.createElement("div");
      block.className = "folder-block";

      const headerRow = document.createElement("div");
      headerRow.className = "folder-header-row";

      const icon = document.createElement("span");
      icon.className = "folder-icon";
      icon.textContent = "📂";

      const name = document.createElement("span");
      name.className = "folder-name";
      name.textContent = getDisplayFolderName(category);

      const count = document.createElement("span");
      count.className = "folder-count";
      count.textContent = items.length;

      const chevron = document.createElement("span");
      chevron.className = "folder-chevron";
      chevron.textContent = "▼";

      headerRow.appendChild(icon);
      headerRow.appendChild(name);
      headerRow.appendChild(count);
      headerRow.appendChild(chevron);

      const filesDiv = document.createElement("div");
      filesDiv.className = "folder-files";

      items.forEach(preset => {
        const chip = document.createElement("div");
        chip.className = "file-chip";
        chip.title = preset.file;
        chip.style.cssText = "display:flex; flex-direction:column; align-items:flex-start; gap:5px;";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = appMode === "sample" ? stripDisplayExtension(preset.file) : stripDisplayExtension(preset.file);
        nameSpan.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;";
        chip.appendChild(nameSpan);

        if (appMode === "sample") {
          const tagsWrap = buildSampleTagsWrap(preset);
          tagsWrap.style.cssText = "display:flex; flex-wrap:wrap; gap:3px; align-items:center;";
          chip.appendChild(tagsWrap);
        } else {
          if (preset.isDuplicate) {
            const dupBadge = document.createElement("span");
            dupBadge.className = "duplicate-badge";
            dupBadge.textContent = "⚠ DUP";
            chip.appendChild(dupBadge);
          }
          const confG = buildConfidenceBadge(preset.confidence);
          if (confG) { confG.style.marginLeft = "0"; chip.appendChild(confG); }
          const tagEl = createSynthTagEl(preset);
          if (tagEl) { tagEl.style.marginLeft = "0"; chip.appendChild(tagEl); }
        }

        filesDiv.appendChild(chip);
      });

      let open = true;
      headerRow.onclick = () => {
        open = !open;
        filesDiv.style.display = open ? "flex" : "none";
        icon.textContent = open ? "📂" : "📁";
        chevron.style.transform = open ? "rotate(0deg)" : "rotate(-90deg)";
      };

      block.appendChild(headerRow);
      block.appendChild(filesDiv);
      container.appendChild(block);
      folderBlocks.push({ icon, chevron, filesDiv, getOpen: () => open, setOpen: (v) => { open = v; } });

    // ── COLUMNS VIEW ─────────────────────────────────────────
    } else {
      const block = document.createElement("div");
      block.className = "folder-block";

      const headerRow = document.createElement("div");
      headerRow.className = "folder-header-row";

      const icon = document.createElement("span");
      icon.className = "folder-icon";
      icon.textContent = "📂";

      const name = document.createElement("span");
      name.className = "folder-name";
      name.textContent = getDisplayFolderName(category);

      const count = document.createElement("span");
      count.className = "folder-count";
      count.textContent = items.length;

      headerRow.appendChild(icon);
      headerRow.appendChild(name);
      headerRow.appendChild(count);

      const filesDiv = document.createElement("div");
      filesDiv.className = "folder-files";

      items.forEach(preset => {
        const row = document.createElement("div");
        row.className = "file-row";
        row.title = preset.file;

        if (appMode === "sample") {
          // Sample mode: name on top, tags row below
          row.style.cssText = "display:flex; flex-direction:column; gap:3px; padding:5px 12px;";

          const nameSpan = document.createElement("span");
          nameSpan.textContent = stripDisplayExtension(preset.file);
          nameSpan.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; color:#bbb;";
          row.appendChild(nameSpan);

          const tagsWrap = buildSampleTagsWrap(preset);
          tagsWrap.style.cssText = "display:flex; flex-wrap:wrap; gap:3px;";
          row.appendChild(tagsWrap);
        } else {
          row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:6px;";
          const nameSpan = document.createElement("span");
          nameSpan.textContent = stripDisplayExtension(preset.file);
          nameSpan.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
          row.appendChild(nameSpan);
          const colTagsC = document.createElement("span");
          colTagsC.style.cssText = "display:inline-flex; align-items:center; gap:3px; flex-shrink:0;";
          if (preset.isDuplicate) {
            const dupBadge = document.createElement("span");
            dupBadge.className = "duplicate-badge";
            dupBadge.textContent = "⚠ DUP";
            colTagsC.appendChild(dupBadge);
          }
          const confC = buildConfidenceBadge(preset.confidence);
          if (confC) colTagsC.appendChild(confC);
          const tagEl = createSynthTagEl(preset);
          if (tagEl) colTagsC.appendChild(tagEl);
          if (colTagsC.children.length) row.appendChild(colTagsC);
        }

        filesDiv.appendChild(row);
      });

      block.appendChild(headerRow);
      block.appendChild(filesDiv);
      container.appendChild(block);
    }
  });

  previewDiv.appendChild(container);

  // ── Expand / Collapse All (list & grid only) ──────────────
  expandBtn.onclick = () => {
    folderBlocks.forEach(({ icon, chevron, filesDiv, setOpen }) => {
      setOpen(true);
      filesDiv.style.display = currentView === "grid" ? "flex" : "block";
      icon.textContent = "📂";
      chevron.style.transform = "rotate(0deg)";
    });
  };

  collapseBtn.onclick = () => {
    folderBlocks.forEach(({ icon, chevron, filesDiv, setOpen }) => {
      setOpen(false);
      filesDiv.style.display = "none";
      icon.textContent = "📁";
      chevron.style.transform = "rotate(-90deg)";
    });
  };

  // Keep the hint in sync every time preview re-renders
  updateSortFolderHint();
}

// ================= START SORT =================
async function startSort() {
  if (!filteredPreviewData.length || isSorting) return;

  isSorting = true;
  statusText.innerText = "Sorting...";
  progressFill.style.width = "0%";

  window.api.onProgress(val => { progressFill.style.width = val + "%"; });

  try {
    let result;
    if (appMode === "sample") {
      result = await window.api.sampleExecute(
        currentFolder,
        filteredPreviewData,
        { mode: keyFilter.mode, notes: [...keyFilter.notes] },
        { min: bpmRange.min, max: bpmRange.max }
      );
    } else {
      result = await window.api.execute(
        currentFolder,
        filteredPreviewData,
        { mode: keyFilter.mode, notes: [...keyFilter.notes] },
        { min: bpmRange.min, max: bpmRange.max }
      );
    }
    // Handle both old (number) and new ({ count, newFolders }) return format
    const count = (typeof result === "object") ? result.count : result;
    const newFolders = (typeof result === "object") ? result.newFolders : [];
    isSorting = false;
    progressFill.style.width = "100%";
    showSortedState(count, newFolders);
  } catch (err) {
    console.error("Sort failed:", err);
    isSorting = false;
    progressFill.style.width = "0%";
    statusText.innerText = "Sort failed. Please try again.";
  }
}

// ================= UNDO CONFIRM DIALOG =================
function showUndoConfirm() {
  const overlay = document.getElementById("undoConfirmOverlay");
  if (overlay) {
    overlay.classList.add("visible");
    // Close on backdrop click
    overlay.onclick = (e) => { if (e.target === overlay) closeUndoConfirm(); };
    // Close on Escape key
    document._undoEscHandler = (e) => { if (e.key === "Escape") closeUndoConfirm(); };
    document.addEventListener("keydown", document._undoEscHandler);
  }
}

function closeUndoConfirm() {
  const overlay = document.getElementById("undoConfirmOverlay");
  if (overlay) overlay.classList.remove("visible");
  if (document._undoEscHandler) {
    document.removeEventListener("keydown", document._undoEscHandler);
    delete document._undoEscHandler;
  }
}

function confirmUndo() {
  closeUndoConfirm();
  undo();
}

// ================= UNDO =================
async function undo() {
  if (isSorting) return;

  const result = appMode === "sample"
    ? await window.api.sampleUndo()
    : await window.api.undo();

  const { count, sourceFolder } = result;

  if (count === 0) { showEmptyState("Nothing to undo."); return; }

  progressFill.style.width = "0%";
  currentFolder = sourceFolder;
  showUndoState(count, sourceFolder);
}

// ================= RESET SESSION =================
function resetSession() {
  currentFolder = null;
  fullPreviewData = [];
  filteredPreviewData = [];
  isSorting = false;
  keyFilter = { mode: "all", notes: new Set() };
  bpmRange = { min: 0, max: 300 };
  progressFill.style.width = "0%";
  const bar = document.getElementById("keyFilterBar");
  if (bar) bar.style.display = "none";
  const hint = document.getElementById("sortFolderHint");
  if (hint) hint.textContent = "";
  resetBpmSlider();
  showEmptyState("Select a folder to sort.");
}

// =============================================================================
// ================= SAMPLE SORTER UI ==========================================
// =============================================================================

// ── Sample Category Toggles ───────────────────────────────────────────────────
function renderSampleCategoryToggles(keywords) {
  const panel = document.getElementById("sampleCategoryPanel");
  panel.innerHTML = "";

  Object.entries(keywords).forEach(([cat]) => {
    if (cat === "_meta") return;
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" class="sample-category-toggle" value="${cat}" checked>
      ${cat}
    `;
    panel.appendChild(label);
  });

  document.querySelectorAll(".sample-category-toggle")
    .forEach(cb => cb.addEventListener("change", applyFilter));
}

// ── Sample Keyword Editor ─────────────────────────────────────────────────────
function renderSampleKeywordEditor(keywords) {
  const container = document.getElementById("sampleKeywordEditor");
  container.innerHTML = "";

  Object.entries(keywords).forEach(([category, data]) => {
    if (category === "_meta") return;

    const wrapper = document.createElement("div");
    wrapper.className = "keyword-category";

    const title = document.createElement("h4");
    title.innerText = category;
    wrapper.appendChild(title);

    const tagContainer = document.createElement("div");
    tagContainer.className = "keyword-tag-container";

    data.default.forEach(word => {
      const tag = document.createElement("div");
      tag.className = "keyword-tag default active";
      tag.innerText = word;
      tag.onclick = () => tag.classList.toggle("active");
      tagContainer.appendChild(tag);
    });

    data.custom.forEach(word => {
      const tag = document.createElement("div");
      tag.className = "keyword-tag custom active";

      const text = document.createElement("span");
      text.innerText = word;

      const remove = document.createElement("span");
      remove.innerText = "✕";
      remove.className = "remove-btn";
      remove.onclick = (e) => {
        e.stopPropagation();
        data.custom = data.custom.filter(w => w !== word);
        window.api.saveSampleKeywords(keywords);
        renderSampleKeywordEditor(keywords);
      };

      tag.onclick = () => tag.classList.toggle("active");
      tag.appendChild(text);
      tag.appendChild(remove);
      tagContainer.appendChild(tag);
    });

    wrapper.appendChild(tagContainer);

    const addWrapper = document.createElement("div");
    addWrapper.className = "keyword-add-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Add custom keyword...";

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        const newWord = input.value.trim().toLowerCase();
        if (!data.custom.includes(newWord)) {
          data.custom.push(newWord);
          window.api.saveSampleKeywords(keywords);
          renderSampleKeywordEditor(keywords);
        }
        input.value = "";
      }
    });

    addWrapper.appendChild(input);
    wrapper.appendChild(addWrapper);
    container.appendChild(wrapper);
  });
}

// ── Restore Sample Defaults ───────────────────────────────────────────────────
async function restoreSampleDefaultKeywords() {
  const keywords = await window.api.restoreSampleDefaults();
  renderSampleCategoryToggles(keywords);
  renderSampleKeywordEditor(keywords);
}
