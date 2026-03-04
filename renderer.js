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
let isAnalyzing = false; // Blocks all folder interactions during scan
let _analysisCancelled = false; // Set to true when user cancels during analysis
let bpmRange = { min: 0, max: 300 }; // BPM slider range
let skipDuplicates = false; // When true, exact duplicates (same name+size) are excluded from sort
let previewSearchQuery = ""; // Smart search query string for the preview pane
let _previewSearchTimer = null; // Debounce timer for search input

// ETA tracking
let _etaStartTime = null;

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

// ================= AUDIO PLAYER =================
// Playback uses an <audio> element + blob URL — crash-safe.
// Web Audio API is used ONLY for waveform generation (isolated, never for playback).
const audioPlayer = (() => {
  let audioEl    = null;
  let waveData   = null;
  let playing    = false;
  let vol        = 0.8;
  let muted      = false;
  let curItem    = null;
  let queue      = [];
  let queueIdx   = -1;
  let _raf       = null;
  let _loadGuard = null;
  let _errorDismissTimer = null;

  const AUDIO_EXTS = new Set([
    ".wav",".mp3",".ogg",".flac",
    ".aif",".aiff",".aifc",
    ".m4a",".aac",".opus",".alac",
    ".rx2",".rex"
  ]);

  function isAudio(item) {
    return AUDIO_EXTS.has((item?.ext || "").toLowerCase());
  }

  function _getAudioEl() {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.volume = muted ? 0 : vol;
      audioEl.addEventListener("ended", () => {
        // Stop after playing — do NOT auto-advance to next track
        playing = false;
        _stopRAF();
        _setIcon("▶");
        _updateProgress(0);
        _updateTime(0, audioEl.duration || 0);
        audioEl.currentTime = 0;
        _refreshAllRowBtns();
      });
      audioEl.addEventListener("error", () => {
        playing = false; _stopRAF(); _setIcon("✕"); _refreshAllRowBtns();
        const err = audioEl.error;
        const codeMap = {
          1: "Playback was aborted by the user.",
          2: "A network error occurred while loading the file.",
          3: "The file could not be decoded — it may be corrupted or use an unsupported codec.",
          4: "The file format is not supported by this player."
        };
        const reason = err ? (codeMap[err.code] || `Unknown error (code ${err.code}).`) : "An unknown playback error occurred.";
        try { _metaEl().textContent = "Playback error"; } catch {}
        _showErrorPopup(reason);
      });
    }
    return audioEl;
  }

  async function loadItem(item, offset = 0) {
    if (!item?.from) return;
    _loadGuard = item.from;
    _stopSrc();
    playing = false; waveData = null; curItem = item;
    _updateInfo(); _showBar(); _setIcon("⏳");

    // Use file:// URL directly — no IPC byte transfer, no Blob, no memory crash.
    const fileURL = "file:///" + item.from.replace(/\\/g, "/").replace(/^\/+/, "");
    const el = _getAudioEl();
    el.src = fileURL;
    if (offset > 0) el.currentTime = offset;

    try {
      await el.play();
      if (_loadGuard !== item.from) { el.pause(); return; }
      playing = true; _setIcon("⏸"); _startRAF(); _refreshAllRowBtns();
      _hideErrorPopup();
    } catch(e) {
      console.error("[AudioPlayer] el.play() failed:", e);
      _setIcon("✕");
      try { _metaEl().textContent = "Playback failed"; } catch {}
      _showErrorPopup(e.message || "The browser refused to play this file.");
    }
  }

  // Waveform canvas is left blank — no Web Audio API used.

  function _stopSrc() {
    const el = _getAudioEl();
    try { el.pause(); el.src = ""; } catch {}
    _stopRAF();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function play(item) {
    queue    = filteredPreviewData.filter(isAudio);
    queueIdx = queue.findIndex(p => p.from === item.from);
    if (queueIdx === -1) { queue = [item]; queueIdx = 0; }
    loadItem(item);
  }

  function togglePlay() {
    const el = _getAudioEl();
    if (!el.src) return;
    if (playing) {
      el.pause(); playing = false; _stopRAF(); _setIcon("▶"); _refreshAllRowBtns();
    } else {
      el.play().then(() => {
        playing = true; _setIcon("⏸"); _startRAF(); _refreshAllRowBtns();
      }).catch(e => console.error("[AudioPlayer] resume failed:", e));
    }
  }

  function stop() {
    const el = _getAudioEl();
    try { el.pause(); el.currentTime = 0; } catch {}
    playing = false; _stopRAF(); _setIcon("▶");
    _updateProgress(0); _updateTime(0, el.duration || 0); _refreshAllRowBtns();
  }

  function seek(frac) {
    const el = _getAudioEl();
    if (!el.src || !isFinite(el.duration)) return;
    el.currentTime = frac * el.duration;
    _updateProgress(frac);
  }

  function prev() { if (queueIdx > 0) { queueIdx--; loadItem(queue[queueIdx]); } }
  function next() {
    if (queueIdx < queue.length - 1) { queueIdx++; loadItem(queue[queueIdx]); }
    else stop();
  }

  function setVolume(v) {
    vol = Math.max(0, Math.min(1, v)); muted = false;
    _getAudioEl().volume = vol; _updateVolSlider(); _updateVolIcon();
  }

  function toggleMute() {
    muted = !muted;
    _getAudioEl().volume = muted ? 0 : vol; _updateVolIcon();
  }

  function close() { stop(); _hideBar(); curItem = null; _refreshAllRowBtns(); }

  function isPlayingItem(path) { return playing && curItem?.from === path; }
  function isLoadedItem(path)  { return curItem?.from === path; }

  // ── RAF progress loop ─────────────────────────────────────────────────────
  function _startRAF() {
    _stopRAF();
    const el = _getAudioEl();
    const tick = () => {
      if (!playing) return;
      const dur  = el.duration || 0;
      const cur  = el.currentTime || 0;
      const frac = dur > 0 ? Math.min(cur / dur, 1) : 0;
      _updateProgress(frac); _updateTime(cur, dur);
      if (frac < 1) _raf = requestAnimationFrame(tick);
    };
    _raf = requestAnimationFrame(tick);
  }
  function _stopRAF() { if (_raf) { cancelAnimationFrame(_raf); _raf = null; } }

  // ── Waveform ──────────────────────────────────────────────────────────────
  function _buildWave(buf) {
    const ch = buf.getChannelData(0);
    const N  = 280;
    const bs = Math.floor(ch.length / N);
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let max = 0;
      const s = i * bs;
      for (let j = 0; j < bs; j++) { const a = Math.abs(ch[s+j]||0); if(a>max)max=a; }
      out[i] = max;
    }
    return out;
  }

  function _drawWave() {
    const canvas = document.getElementById("playerWaveCanvas");
    if (!canvas || !waveData) return;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    if (w < 4 || h < 4) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const c = canvas.getContext("2d");
    c.scale(dpr, dpr); c.clearRect(0, 0, w, h);
    const bw = w / waveData.length;
    const mid = h / 2, amp = h / 2 - 2;
    for (let i = 0; i < waveData.length; i++) {
      const peak = waveData[i];
      const barH = Math.max(1, peak * amp);
      c.fillStyle = `rgba(${Math.round(80+peak*140)},0,${Math.round(148+peak*107)},0.8)`;
      c.fillRect(i * bw, mid - barH, Math.max(1, bw - 0.5), barH * 2);
    }
  }

  function _drawWaveWhenReady() {
    const wrap = document.getElementById("playerWaveformWrap");
    if (!wrap) { _drawWave(); return; }
    if (wrap.offsetWidth > 4) { _drawWave(); return; }
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        if (e.contentRect.width > 4) { ro.disconnect(); _drawWave(); return; }
      }
    });
    ro.observe(wrap);
    setTimeout(() => ro.disconnect(), 1000);
  }

  // ── Error popup ───────────────────────────────────────────────────────────
  function _showErrorPopup(reason) {
    const popup = document.getElementById("playerErrorPopup");
    const msg   = document.getElementById("playerErrorMsg");
    if (!popup) return;
    if (msg) msg.textContent = reason || "Unable to play this file.";
    popup.classList.add("visible");
    // Auto-dismiss after 12 s
    clearTimeout(_errorDismissTimer);
    _errorDismissTimer = setTimeout(() => _hideErrorPopup(), 12000);
  }
  function _hideErrorPopup() {
    const popup = document.getElementById("playerErrorPopup");
    if (popup) popup.classList.remove("visible");
    clearTimeout(_errorDismissTimer);
  }

  // ── Bar show/hide ─────────────────────────────────────────────────────────
  function _showBar() {
    const b = document.getElementById("audioPlayerBar");
    if (b) { b.classList.add("visible"); document.body.classList.add("player-open"); }
  }
  function _hideBar() {
    const b = document.getElementById("audioPlayerBar");
    if (b) { b.classList.remove("visible"); document.body.classList.remove("player-open"); }
  }
  function _setIcon(ic) {
    const svg = document.getElementById("playerPlayIcon");
    if (!svg) return;
    if (ic === "⏸") {
      svg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    } else if (ic === "⏳") {
      svg.innerHTML = '<path d="M6 2v6l4 4-4 4v6h12v-6l-4-4 4-4V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5-4-4V4h8v3.5l-4 4z"/>';
    } else if (ic === "✕") {
      svg.innerHTML = '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>';
    } else {
      svg.innerHTML = '<path d="M8 5v14l11-7z"/>';
    }
  }
  function _nameEl()  { return document.getElementById("playerFilename"); }
  function _metaEl()  { return document.getElementById("playerMeta"); }
  function _timeEl()  { return document.getElementById("playerTimeDisplay"); }
  function _progEl()  { return document.getElementById("playerProgressOverlay"); }

  function _updateInfo() {
    if (!curItem) return;
    const n = _nameEl();
    if (n) { n.textContent = curItem.file.replace(/\.[^.]+$/, ""); n.title = curItem.from; }
    const m = _metaEl();
    if (m) {
      const parts = [];
      if (curItem.metadata?.bpm) parts.push(Math.round(curItem.metadata.bpm) + " BPM");
      if (curItem.metadata?.key) parts.push(curItem.metadata.key.toUpperCase());
      if (curItem.sampleType && curItem.sampleType !== "unknown")
        parts.push(curItem.sampleType === "one-shot" ? "One Shot" : "Loop");
      if (curItem.ext) parts.push(curItem.ext.replace(".","").toUpperCase());
      m.textContent = parts.join("  ·  ");
    }
    const pb = document.getElementById("playerPrevBtn");
    const nb = document.getElementById("playerNextBtn");
    if (pb) pb.style.opacity = queueIdx <= 0 ? "0.3" : "1";
    if (nb) nb.style.opacity = queueIdx >= queue.length-1 ? "0.3" : "1";
  }

  function _updateProgress(frac) { const el = _progEl(); if (el) el.style.width = (frac*100)+"%"; }
  function _updateTime(cur, dur) { const el = _timeEl(); if (el) el.textContent = `${_fmtTime(cur)} / ${_fmtTime(dur)}`; }
  function _updateVolSlider() {
    const s = document.getElementById("playerVolumeSlider");
    if (s) { s.value = vol; s.style.setProperty("--vol", Math.round(vol*100)+"%"); }
  }
  function _updateVolIcon() {
    const svg = document.getElementById("playerVolSvg");
    if (!svg) return;
    if (muted || vol === 0) {
      svg.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>';
    } else if (vol < 0.4) {
      svg.innerHTML = '<path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>';
    } else {
      svg.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    }
  }
  function _refreshAllRowBtns() {
    // List/columns view: .row-play-area + .row-play-icon inside .row-name-cell
    document.querySelectorAll(".row-play-area").forEach(area => {
      const active = area.dataset.from === curItem?.from && playing;
      area.classList.toggle("is-playing", active);
      const icon = area.querySelector(".row-play-icon");
      if (icon) icon.textContent = active ? "■" : "▶";
    });
    // Grid view chips still use the old .row-play-btn class
    document.querySelectorAll(".row-play-btn").forEach(btn => {
      const active = btn.dataset.from === curItem?.from && playing;
      btn.classList.toggle("is-playing", active);
      btn.textContent = active ? "■" : "▶";
    });
  }

  // ── DOM event wiring ──────────────────────────────────────────────────────
  function initDOM() {
    document.getElementById("playerPlayBtn")?.addEventListener("click", togglePlay);
    document.getElementById("playerPrevBtn")?.addEventListener("click", prev);
    document.getElementById("playerNextBtn")?.addEventListener("click", next);
    document.getElementById("playerCloseBtn")?.addEventListener("click", close);
    document.getElementById("playerVolIcon")?.addEventListener("click", toggleMute);

    // Error popup
    document.getElementById("playerErrorClose")?.addEventListener("click", _hideErrorPopup);
    document.getElementById("playerErrOpenDefault")?.addEventListener("click", () => {
      // openFolder uses shell.openPath — works for files too, opens in default app
      if (curItem?.from && window.api?.openFolder) window.api.openFolder(curItem.from);
      _hideErrorPopup();
    });
    document.getElementById("playerErrReveal")?.addEventListener("click", () => {
      if (curItem?.from && window.api?.showInFolder) window.api.showInFolder(curItem.from);
      _hideErrorPopup();
    });

    const vs = document.getElementById("playerVolumeSlider");
    if (vs) {
      vs.value = vol;
      vs.style.setProperty("--vol", Math.round(vol*100)+"%");
      vs.addEventListener("input", () => setVolume(parseFloat(vs.value)));
    }

    const ww = document.getElementById("playerWaveformWrap");
    if (ww) {
      let scrub = false;
      const doSeek = e => {
        const r = ww.getBoundingClientRect();
        seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      };
      ww.addEventListener("mousedown", e => { scrub = true; doSeek(e); });
      window.addEventListener("mousemove", e => { if (scrub) doSeek(e); });
      window.addEventListener("mouseup", () => { scrub = false; });
    }

    window.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (!document.getElementById("audioPlayerBar")?.classList.contains("visible")) return;
      const el = _getAudioEl();
      const frac = () => el.duration ? el.currentTime / el.duration : 0;
      if (e.code === "Space")      { e.preventDefault(); togglePlay(); }
      else if (e.code === "ArrowLeft")  { e.preventDefault(); seek(Math.max(0, frac()-0.05)); }
      else if (e.code === "ArrowRight") { e.preventDefault(); seek(Math.min(1, frac()+0.05)); }
      else if (e.code === "Escape")     { e.preventDefault(); close(); }
      else if (e.code === "KeyN")       { e.preventDefault(); next(); }
      else if (e.code === "KeyP")       { e.preventDefault(); prev(); }
    });

    window.addEventListener("resize", () => { if (waveData) _drawWave(); });
  }

  return { play, togglePlay, stop, prev, next, setVolume, toggleMute, close,
           initDOM, isPlayingItem, isLoadedItem, isAudio,
           refreshRowBtns: _refreshAllRowBtns };
})();

// Wire up audio player DOM after everything is in the DOM
window.addEventListener("load", () => audioPlayer.initDOM());

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
  const bpmIsFiltered = bpmRange.min > 0 || bpmRange.max < 300;
  const bpmFilteredData = fullPreviewData.filter(p => {
    const bpmRaw = parseFloat(p.metadata?.bpm || 0);
    if (!bpmIsFiltered) return true; // no active BPM filter — include all
    if (bpmRaw <= 0) return false;   // no BPM data → excluded when filter is active
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

// ── ETA helpers ───────────────────────────────────────────────────────────────
function formatETA(ms) {
  if (!isFinite(ms) || ms <= 0) return "";
  const sec = Math.ceil(ms / 1000);
  if (sec < 5)  return "almost done…";
  if (sec < 60) return `~${sec}s remaining`;
  const min = Math.floor(sec / 60);
  const s   = sec % 60;
  return s === 0 ? `~${min}m remaining` : `~${min}m ${s}s remaining`;
}

function calcETA(pct) {
  if (!_etaStartTime || pct <= 0) return "";
  const elapsed = Date.now() - _etaStartTime;
  const total   = elapsed / (pct / 100);
  return formatETA(total - elapsed);
}

// ── BPM slider debounce ───────────────────────────────────────────────────────
// The slider fires oninput on every pixel of drag. With large sample sets,
// applyFilter → renderPreview can take 50-200ms, making the thumb feel sticky.
// Fix: update the visual display immediately (cheap), but schedule the heavy
// applyFilter call through a 120ms trailing-edge debounce so it only fires
// once the user stops dragging (or pauses for >120ms).
let _bpmFilterTimer = null;

function scheduleBpmFilter() {
  if (_bpmFilterTimer !== null) clearTimeout(_bpmFilterTimer);
  _bpmFilterTimer = setTimeout(() => {
    _bpmFilterTimer = null;
    applyFilter();
  }, 120);
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

  // Hide search bar when there's no data
  const sb = document.getElementById("previewSearchBar");
  if (sb) sb.style.display = "none";

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
    if (isSorting || isAnalyzing) return;
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

// ================= ANALYZING STATE =================
// Full-canvas animated overlay shown while scanning files.
// Uses a canvas-based particle audio visualizer matching the purple theme.
let _analyzeAnimFrame = null;
let _analyzeProgressVal = 0;

function showAnalyzingState(modeLabel) {
  clearPreviewInteractivity();
  previewDiv.innerHTML = "";
  previewDiv.classList.add("is-analyzing");
  previewDiv.style.position = "relative";
  previewDiv.style.overflow = "hidden";

  // Dim the Select Folder button to signal it's disabled
  const sfBtn = document.querySelector("button[onclick*='selectFolder'], button[onclick*='selectFolder']");
  document.querySelectorAll(".toolbar button, .header button").forEach(b => {
    const txt = b.textContent.trim();
    if (txt.includes("Select Folder") || txt.includes("Start Sort") || txt.includes("Undo")) {
      b.disabled = true;
      b.style.opacity = "0.4";
      b.style.pointerEvents = "none";
      b.style.cursor = "not-allowed";
      b.dataset._analyzingDisabled = "1";
    }
  });

  // ── Canvas ────────────────────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.id = "analyzeCanvas";
  canvas.style.cssText = `
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    display: block;
  `;
  previewDiv.appendChild(canvas);

  // ── Text overlay ─────────────────────────────────────────────────────────
  const textWrap = document.createElement("div");
  textWrap.id = "analyzeTextWrap";
  textWrap.style.cssText = `
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    pointer-events: none; gap: 10px;
    z-index: 2;
  `;

  const iconWrap = document.createElement("div");
  iconWrap.style.cssText = `
    font-size: 38px; line-height: 1;
    animation: analyzeIconPulse 1.8s ease-in-out infinite;
  `;
  iconWrap.textContent = appMode === "sample" ? "🎵" : "🎛️";

  const titleEl = document.createElement("div");
  titleEl.style.cssText = `
    font-size: 16px; font-weight: 700;
    color: #fff; letter-spacing: 0.03em;
    text-shadow: 0 0 20px rgba(148,0,211,0.9);
  `;
  titleEl.textContent = `Analyzing ${modeLabel}…`;

  const subEl = document.createElement("div");
  subEl.id = "analyzeSubText";
  subEl.style.cssText = `
    font-size: 12px; color: rgba(200,160,255,0.75);
    letter-spacing: 0.02em;
  `;
  subEl.textContent = "Scanning files…";

  const pctEl = document.createElement("div");
  pctEl.id = "analyzePctText";
  pctEl.style.cssText = `
    font-size: 28px; font-weight: 800;
    color: #c084fc;
    text-shadow: 0 0 30px rgba(192,132,252,0.6);
    letter-spacing: -0.02em;
    min-width: 64px; text-align: center;
    font-variant-numeric: tabular-nums;
  `;
  pctEl.textContent = "0%";

  // Mini progress track below percentage
  const miniTrackWrap = document.createElement("div");
  miniTrackWrap.style.cssText = `
    width: 200px; height: 4px;
    background: rgba(148,0,211,0.18);
    border-radius: 10px; overflow: hidden;
    margin-top: 4px;
  `;
  const miniFill = document.createElement("div");
  miniFill.id = "analyzeMiniBar";
  miniFill.style.cssText = `
    height: 100%; width: 0%;
    background: linear-gradient(90deg, #9400d3, #c084fc, #9400d3);
    background-size: 200% 100%;
    border-radius: 10px;
    transition: width 0.25s ease;
    animation: analyzeBarShimmer 1.6s linear infinite;
  `;
  miniTrackWrap.appendChild(miniFill);

  textWrap.appendChild(iconWrap);
  textWrap.appendChild(pctEl);
  textWrap.appendChild(titleEl);
  textWrap.appendChild(subEl);
  textWrap.appendChild(miniTrackWrap);
  previewDiv.appendChild(textWrap);

  // ── Start canvas animation ────────────────────────────────────────────────
  _analyzeProgressVal = 0;
  _startAnalyzeCanvas(canvas);
}

function updateAnalyzingProgress(val, label) {
  _analyzeProgressVal = val;
  const pctEl  = document.getElementById("analyzePctText");
  const barEl  = document.getElementById("analyzeMiniBar");
  const subEl  = document.getElementById("analyzeSubText");
  if (pctEl)  pctEl.textContent  = val + "%";
  if (barEl)  barEl.style.width  = val + "%";
  if (subEl && label) subEl.textContent = label;
}

function stopAnalyzingState() {
  if (_analyzeAnimFrame) {
    cancelAnimationFrame(_analyzeAnimFrame);
    _analyzeAnimFrame = null;
  }
  previewDiv.classList.remove("is-analyzing");
  // Restore all disabled toolbar buttons
  document.querySelectorAll(".toolbar button, .header button").forEach(b => {
    if (b.dataset._analyzingDisabled) {
      b.disabled = false;
      b.style.opacity = "";
      b.style.pointerEvents = "";
      b.style.cursor = "";
      delete b.dataset._analyzingDisabled;
    }
  });
  // Canvas stays visible briefly, cleared by the next renderPreview/showEmptyState call
}

function _startAnalyzeCanvas(canvas) {
  const W = () => canvas.offsetWidth  || 800;
  const H = () => canvas.offsetHeight || 400;

  // Resize canvas resolution to actual px size
  function resize() {
    canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1);
    canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
  }
  resize();
  window.addEventListener("resize", resize);

  const ctx = canvas.getContext("2d");

  // ── Particles ─────────────────────────────────────────────────────────────
  const PARTICLE_COUNT = 72;
  const particles = [];

  function randBetween(a, b) { return a + Math.random() * (b - a); }

  // Purple/violet/magenta palette matching the app theme
  const PALETTE = [
    "rgba(148,0,211,",    // deep purple
    "rgba(192,132,252,",  // lavender
    "rgba(220,100,255,",  // bright violet
    "rgba(100,0,180,",    // dark indigo
    "rgba(255,100,255,",  // magenta
    "rgba(80,0,160,",     // near-black purple
  ];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random(),          // 0-1 normalised
      y: Math.random(),
      vx: randBetween(-0.06, 0.06),
      vy: randBetween(-0.06, 0.06),
      r: randBetween(1.5, 5),
      alpha: randBetween(0.3, 0.85),
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      phase: Math.random() * Math.PI * 2,
      speed: randBetween(0.004, 0.012),
    });
  }

  // ── Audio bars (fake equalizer driven by time + progress) ─────────────────
  const BAR_COUNT = 48;
  const barPhases = Array.from({ length: BAR_COUNT }, (_, i) => i * 0.41 + Math.random() * Math.PI);
  const barSpeeds = Array.from({ length: BAR_COUNT }, () => randBetween(0.6, 2.2));

  let t = 0;
  let lastTime = performance.now();

  function draw(now) {
    _analyzeAnimFrame = requestAnimationFrame(draw);
    const dt = Math.min((now - lastTime) / 16.67, 3); // delta in "frames" (capped)
    lastTime = now;
    t += dt;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width;
    const ch = canvas.height;

    // Logical size (unscaled)
    const lw = cw / dpr;
    const lh = ch / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ── Background ─────────────────────────────────────────────────────────
    // Fade to near-black with a subtle purple core
    ctx.clearRect(0, 0, lw, lh);
    ctx.fillStyle = "#0d0d0f";
    ctx.fillRect(0, 0, lw, lh);

    // Radial glow in centre — intensifies as progress grows
    const progress = _analyzeProgressVal / 100;
    const glowR = Math.min(lw, lh) * (0.25 + progress * 0.2);
    const grd = ctx.createRadialGradient(lw / 2, lh / 2, 0, lw / 2, lh / 2, glowR);
    grd.addColorStop(0, `rgba(148,0,211,${0.07 + progress * 0.08})`);
    grd.addColorStop(0.5, `rgba(80,0,160,${0.04 + progress * 0.04})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, lw, lh);

    // ── Equalizer bars at bottom ────────────────────────────────────────────
    const barW    = lw / (BAR_COUNT * 1.6);
    const barGap  = (lw - BAR_COUNT * barW) / (BAR_COUNT + 1);
    const baseY   = lh * 0.82;
    const maxBarH = lh * 0.32;

    for (let i = 0; i < BAR_COUNT; i++) {
      const phase = barPhases[i] + t * barSpeeds[i] * 0.04;
      // Drive amplitude from progress — bars grow as files are scanned
      const amp  = 0.15 + progress * 0.7 + Math.sin(t * 0.03 + i * 0.3) * 0.08;
      const h    = Math.abs(Math.sin(phase) * maxBarH * amp) + 3;
      const x    = barGap + i * (barW + barGap);

      // Mirror: bar grows upward from baseY, with a reflection below
      const barAlpha = 0.55 + 0.35 * (h / maxBarH);
      const colorIdx = Math.floor(i / BAR_COUNT * PALETTE.length) % PALETTE.length;

      // Main bar
      const barGrd = ctx.createLinearGradient(0, baseY - h, 0, baseY);
      barGrd.addColorStop(0, `${PALETTE[colorIdx]}${barAlpha.toFixed(2)})`);
      barGrd.addColorStop(0.5, `${PALETTE[(colorIdx + 1) % PALETTE.length]}${(barAlpha * 0.8).toFixed(2)})`);
      barGrd.addColorStop(1, `${PALETTE[colorIdx]}0.05)`);
      ctx.fillStyle = barGrd;
      ctx.beginPath();
      ctx.roundRect(x, baseY - h, barW, h, [2, 2, 0, 0]);
      ctx.fill();

      // Reflection (mirrored, faded)
      const refGrd = ctx.createLinearGradient(0, baseY, 0, baseY + h * 0.45);
      refGrd.addColorStop(0, `${PALETTE[colorIdx]}0.18)`);
      refGrd.addColorStop(1, `${PALETTE[colorIdx]}0.0)`);
      ctx.fillStyle = refGrd;
      ctx.beginPath();
      ctx.roundRect(x, baseY, barW, h * 0.45, [0, 0, 2, 2]);
      ctx.fill();
    }

    // ── Particles ───────────────────────────────────────────────────────────
    for (const p of particles) {
      p.phase += p.speed * dt;
      // Gently drift
      p.x += p.vx * 0.002 * dt;
      p.y += p.vy * 0.002 * dt;
      // Wrap
      if (p.x < -0.05) p.x = 1.05;
      if (p.x > 1.05)  p.x = -0.05;
      if (p.y < -0.05) p.y = 1.05;
      if (p.y > 1.05)  p.y = -0.05;

      const pulse  = 0.5 + 0.5 * Math.sin(p.phase);
      const alpha  = p.alpha * (0.4 + 0.6 * pulse);
      const radius = p.r * (0.7 + 0.5 * pulse);
      ctx.beginPath();
      ctx.arc(p.x * lw, p.y * lh, radius, 0, Math.PI * 2);
      ctx.fillStyle = `${p.color}${alpha.toFixed(2)})`;
      ctx.fill();

      // Soft glow halo
      if (radius > 3) {
        const g = ctx.createRadialGradient(p.x * lw, p.y * lh, 0, p.x * lw, p.y * lh, radius * 3.5);
        g.addColorStop(0, `${p.color}${(alpha * 0.35).toFixed(2)})`);
        g.addColorStop(1, `${p.color}0.0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x * lw, p.y * lh, radius * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Connecting lines between close particles ────────────────────────────
    const lineThresh = 0.18;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < lineThresh) {
          const lineAlpha = (1 - dist / lineThresh) * 0.12 * progress;
          ctx.beginPath();
          ctx.moveTo(particles[i].x * lw, particles[i].y * lh);
          ctx.lineTo(particles[j].x * lw, particles[j].y * lh);
          ctx.strokeStyle = `rgba(148,0,211,${lineAlpha.toFixed(3)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    // ── Scanning sweep line ──────────────────────────────────────────────────
    // A vertical purple line that sweeps left→right as progress advances
    const sweepX = lw * progress;
    if (progress > 0 && progress < 1) {
      const swpGrd = ctx.createLinearGradient(sweepX - 24, 0, sweepX + 2, 0);
      swpGrd.addColorStop(0, "rgba(148,0,211,0.0)");
      swpGrd.addColorStop(0.7, "rgba(192,132,252,0.12)");
      swpGrd.addColorStop(1, "rgba(220,100,255,0.75)");
      ctx.fillStyle = swpGrd;
      ctx.fillRect(sweepX - 24, 0, 26, lh);

      // Bright leading edge
      ctx.beginPath();
      ctx.moveTo(sweepX, 0);
      ctx.lineTo(sweepX, lh);
      ctx.strokeStyle = "rgba(220,100,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // ── Completed fill overlay ───────────────────────────────────────────────
    // A very subtle tinted fill to the left of the sweep line
    if (progress > 0) {
      ctx.fillStyle = `rgba(148,0,211,${0.04 * progress})`;
      ctx.fillRect(0, 0, sweepX, lh);
    }
  }


  requestAnimationFrame(draw);
}

// =============================================================================
// ================= SORT ANIMATION ===========================================
// =============================================================================

let _sortAnimFrame  = null;
let _sortProgressVal = 0;

function showSortingAnimation(totalCount) {
  clearPreviewInteractivity();
  previewDiv.innerHTML = "";
  previewDiv.classList.add("is-analyzing");
  previewDiv.style.position = "relative";
  previewDiv.style.overflow = "hidden";
  _sortProgressVal = 0;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  previewDiv.appendChild(canvas);

  const textWrap = document.createElement("div");
  textWrap.style.cssText = `
    position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;pointer-events:none;
    gap:8px;z-index:2;
  `;

  const iconEl = document.createElement("div");
  iconEl.style.cssText = "font-size:36px;line-height:1;animation:sortIconSpin 2s linear infinite;";
  iconEl.textContent = "⚙️";

  const pctEl = document.createElement("div");
  pctEl.id = "sortPctText";
  pctEl.style.cssText = `
    font-size:28px;font-weight:800;color:#c084fc;
    text-shadow:0 0 30px rgba(192,132,252,0.6);
    letter-spacing:-0.02em;font-variant-numeric:tabular-nums;
    min-width:64px;text-align:center;
  `;
  pctEl.textContent = "0%";

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-size:16px;font-weight:700;color:#fff;letter-spacing:0.03em;text-shadow:0 0 20px rgba(148,0,211,0.9);";
  titleEl.textContent = `Sorting ${totalCount} files…`;

  const subEl = document.createElement("div");
  subEl.id = "sortSubText";
  subEl.style.cssText = "font-size:12px;color:rgba(200,160,255,0.75);";
  subEl.textContent = "Moving files into folders…";

  const miniTrackWrap = document.createElement("div");
  miniTrackWrap.style.cssText = "width:200px;height:4px;background:rgba(148,0,211,0.18);border-radius:10px;overflow:hidden;margin-top:4px;";
  const miniFill = document.createElement("div");
  miniFill.id = "sortMiniBar";
  miniFill.style.cssText = `height:100%;width:0%;background:linear-gradient(90deg,#9400d3,#c084fc,#9400d3);
    background-size:200% 100%;border-radius:10px;transition:width 0.2s ease;
    animation:analyzeBarShimmer 1.6s linear infinite;`;
  miniTrackWrap.appendChild(miniFill);

  textWrap.appendChild(iconEl);
  textWrap.appendChild(pctEl);
  textWrap.appendChild(titleEl);
  textWrap.appendChild(subEl);
  textWrap.appendChild(miniTrackWrap);
  previewDiv.appendChild(textWrap);

  _startSortCanvas(canvas);
}

function updateSortProgress(val, eta) {
  _sortProgressVal = val;
  const p = document.getElementById("sortPctText");
  const b = document.getElementById("sortMiniBar");
  const s = document.getElementById("sortSubText");
  if (p) p.textContent = val + "%";
  if (b) b.style.width  = val + "%";
  if (s && val > 0) s.textContent = eta ? `${val}% complete  —  ${eta}` : `${val}% complete…`;
}

function stopSortAnimation() {
  if (_sortAnimFrame) { cancelAnimationFrame(_sortAnimFrame); _sortAnimFrame = null; }
  previewDiv.classList.remove("is-analyzing");
}

function _startSortCanvas(canvas) {
  function resize() {
    canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1);
    canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
  }
  resize();
  window.addEventListener("resize", resize);
  const ctx = canvas.getContext("2d");

  // Flying file "cards" that shoot rightward into sorted folder slots
  const CARD_COUNT = 36;
  const cards = [];
  const COLORS = [
    "rgba(148,0,211,", "rgba(192,132,252,", "rgba(220,100,255,",
    "rgba(100,0,180,", "rgba(255,100,255,",
  ];

  function spawnCard() {
    return {
      x: -60,
      y: (0.15 + Math.random() * 0.7),
      vx: 3.5 + Math.random() * 5,
      vy: (Math.random() - 0.5) * 0.3,
      w: 40 + Math.random() * 30,
      h: 22 + Math.random() * 12,
      alpha: 0.7 + Math.random() * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: (Math.random() - 0.5) * 0.25,
      delay: Math.random() * 120,
    };
  }
  for (let i = 0; i < CARD_COUNT; i++) {
    const c = spawnCard();
    c.x = Math.random(); // normalised 0-1 scatter initial
    c.delay = 0;
    cards.push(c);
  }

  let t = 0;
  let lastTime = performance.now();

  function draw(now) {
    _sortAnimFrame = requestAnimationFrame(draw);
    const dt = Math.min((now - lastTime) / 16.67, 3);
    lastTime = now;
    t += dt;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width, ch = canvas.height;
    const lw = cw / dpr, lh = ch / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const progress = _sortProgressVal / 100;

    // Background
    ctx.fillStyle = "#0d0d0f";
    ctx.fillRect(0, 0, lw, lh);

    // Central radial glow — grows with progress
    const grd = ctx.createRadialGradient(lw/2, lh/2, 0, lw/2, lh/2, Math.min(lw,lh)*0.55);
    grd.addColorStop(0, `rgba(148,0,211,${0.06 + progress*0.1})`);
    grd.addColorStop(0.6, `rgba(80,0,160,${0.03 + progress*0.04})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, lw, lh);

    // Progress fill from left
    if (progress > 0) {
      const pGrd = ctx.createLinearGradient(0, 0, lw * progress, 0);
      pGrd.addColorStop(0,   "rgba(148,0,211,0.06)");
      pGrd.addColorStop(0.85, "rgba(192,132,252,0.10)");
      pGrd.addColorStop(1,   "rgba(220,100,255,0.0)");
      ctx.fillStyle = pGrd;
      ctx.fillRect(0, 0, lw * progress, lh);
    }

    // Right-side "sorted folder" target zone
    const targetX = lw * 0.82;
    const tGrd = ctx.createLinearGradient(targetX, 0, lw, 0);
    tGrd.addColorStop(0, "rgba(148,0,211,0.0)");
    tGrd.addColorStop(0.3, `rgba(148,0,211,${0.06 + progress*0.12})`);
    tGrd.addColorStop(1, `rgba(80,0,160,${0.12 + progress*0.1})`);
    ctx.fillStyle = tGrd;
    ctx.fillRect(targetX, 0, lw - targetX, lh);

    // Folder icon on right
    ctx.font = `${28 + progress*8}px serif`;
    ctx.globalAlpha = 0.25 + progress * 0.5;
    ctx.fillText("📁", lw * 0.88 - 14, lh * 0.5 + 10);
    ctx.globalAlpha = 1;

    // Flying cards
    for (const c of cards) {
      if (c.delay > 0) { c.delay -= dt; continue; }
      c.x += (c.vx * (1 + progress * 1.5)) * 0.004 * dt;
      c.y += c.vy * 0.003 * dt;

      // Bounce y at edges
      if (c.y < 0.05) { c.y = 0.05; c.vy = Math.abs(c.vy); }
      if (c.y > 0.92) { c.y = 0.92; c.vy = -Math.abs(c.vy); }

      // Respawn when off right edge
      if (c.x > 1.15) {
        Object.assign(c, spawnCard());
        continue;
      }

      const cx = c.x * lw;
      const cy = c.y * lh;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(c.rot);

      // Card body
      const cardGrd = ctx.createLinearGradient(-c.w/2, -c.h/2, c.w/2, c.h/2);
      cardGrd.addColorStop(0, `${c.color}${(c.alpha * 0.9).toFixed(2)})`);
      cardGrd.addColorStop(1, `${c.color}${(c.alpha * 0.4).toFixed(2)})`);
      ctx.fillStyle = cardGrd;
      ctx.beginPath();
      ctx.roundRect(-c.w/2, -c.h/2, c.w, c.h, 4);
      ctx.fill();

      // Card border
      ctx.strokeStyle = `${c.color}0.6)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Motion trail lines
      ctx.strokeStyle = `${c.color}${(c.alpha * 0.2).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-c.w/2, 0);
      ctx.lineTo(-c.w/2 - 20 - c.vx * 3, 0);
      ctx.stroke();

      ctx.restore();
    }

    // Sweep line at progress boundary
    const sweepX = lw * progress;
    if (progress > 0.01 && progress < 0.99) {
      const swpGrd = ctx.createLinearGradient(sweepX - 20, 0, sweepX + 2, 0);
      swpGrd.addColorStop(0, "rgba(148,0,211,0.0)");
      swpGrd.addColorStop(1, "rgba(220,100,255,0.8)");
      ctx.fillStyle = swpGrd;
      ctx.fillRect(sweepX - 20, 0, 22, lh);
      ctx.beginPath();
      ctx.moveTo(sweepX, 0); ctx.lineTo(sweepX, lh);
      ctx.strokeStyle = "rgba(220,100,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  requestAnimationFrame(draw);
}

// =============================================================================
// ================= UNDO ANIMATION ============================================
// =============================================================================

let _undoAnimFrame = null;

function showUndoAnimation() {
  clearPreviewInteractivity();
  previewDiv.innerHTML = "";
  previewDiv.classList.add("is-analyzing");
  previewDiv.style.position = "relative";
  previewDiv.style.overflow = "hidden";

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  previewDiv.appendChild(canvas);

  const textWrap = document.createElement("div");
  textWrap.style.cssText = `
    position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;pointer-events:none;
    gap:8px;z-index:2;
  `;

  const iconEl = document.createElement("div");
  iconEl.style.cssText = "font-size:36px;line-height:1;animation:undoIconRewind 1s ease-in-out infinite;";
  iconEl.textContent = "↩️";

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-size:16px;font-weight:700;color:#fff;letter-spacing:0.03em;text-shadow:0 0 20px rgba(148,0,211,0.9);";
  titleEl.textContent = "Restoring original locations…";

  const subEl = document.createElement("div");
  subEl.className = "undo-sub-text";
  subEl.style.cssText = "font-size:12px;color:rgba(200,160,255,0.75);";
  subEl.textContent = "Moving files back and removing empty folders";

  const dotWrap = document.createElement("div");
  dotWrap.style.cssText = "display:flex;gap:7px;margin-top:6px;";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("div");
    dot.style.cssText = `
      width:7px;height:7px;border-radius:50%;
      background:#9400d3;
      animation:undoDotBounce 1.1s ease-in-out infinite;
      animation-delay:${i * 0.18}s;
    `;
    dotWrap.appendChild(dot);
  }

  textWrap.appendChild(iconEl);
  textWrap.appendChild(titleEl);
  textWrap.appendChild(subEl);
  textWrap.appendChild(dotWrap);
  previewDiv.appendChild(textWrap);

  _startUndoCanvas(canvas);
}

function stopUndoAnimation() {
  if (_undoAnimFrame) { cancelAnimationFrame(_undoAnimFrame); _undoAnimFrame = null; }
  previewDiv.classList.remove("is-analyzing");
}

function _startUndoCanvas(canvas) {
  function resize() {
    canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1);
    canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
  }
  resize();
  window.addEventListener("resize", resize);
  const ctx = canvas.getContext("2d");

  const COLORS = [
    "rgba(148,0,211,", "rgba(192,132,252,", "rgba(100,0,180,",
    "rgba(220,100,255,", "rgba(80,0,160,",
  ];

  // Cards flying RIGHT → LEFT (reverse of sort)
  const CARD_COUNT = 32;
  const cards = [];
  function spawnUndo() {
    return {
      x: 1.1 + Math.random() * 0.3,
      y: 0.12 + Math.random() * 0.76,
      vx: -(3 + Math.random() * 5),  // negative = leftward
      vy: (Math.random() - 0.5) * 0.3,
      w: 36 + Math.random() * 28, h: 20 + Math.random() * 12,
      alpha: 0.6 + Math.random() * 0.35,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: (Math.random() - 0.5) * 0.3,
    };
  }
  for (let i = 0; i < CARD_COUNT; i++) {
    const c = spawnUndo();
    c.x = Math.random();
    cards.push(c);
  }

  // Rewind arc particles — orbit around centre counter-clockwise
  const ARC_COUNT = 28;
  const arcs = Array.from({ length: ARC_COUNT }, (_, i) => ({
    angle: (i / ARC_COUNT) * Math.PI * 2,
    radius: 0.12 + Math.random() * 0.18,
    speed: -(0.018 + Math.random() * 0.02), // negative = CCW
    size: 2 + Math.random() * 4,
    alpha: 0.4 + Math.random() * 0.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  let t = 0, lastTime = performance.now();

  function draw(now) {
    _undoAnimFrame = requestAnimationFrame(draw);
    const dt = Math.min((now - lastTime) / 16.67, 3);
    lastTime = now;
    t += dt;

    const dpr = window.devicePixelRatio || 1;
    const lw = canvas.width / dpr, lh = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#0d0d0f";
    ctx.fillRect(0, 0, lw, lh);

    // Warm purple-magenta radial glow
    const grd = ctx.createRadialGradient(lw*0.5, lh*0.5, 0, lw*0.5, lh*0.5, Math.min(lw,lh)*0.5);
    grd.addColorStop(0, "rgba(148,0,211,0.10)");
    grd.addColorStop(0.5, "rgba(80,0,160,0.05)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, lw, lh);

    // Right side fades out (source — already sorted)
    const fadeGrd = ctx.createLinearGradient(lw*0.6, 0, lw, 0);
    fadeGrd.addColorStop(0, "rgba(80,0,160,0.0)");
    fadeGrd.addColorStop(1, "rgba(80,0,160,0.12)");
    ctx.fillStyle = fadeGrd;
    ctx.fillRect(lw*0.6, 0, lw*0.4, lh);

    // Left folder target
    ctx.font = "28px serif";
    ctx.globalAlpha = 0.4;
    ctx.fillText("📂", lw*0.06, lh*0.5 + 10);
    ctx.globalAlpha = 1;

    // Flying cards (leftward)
    for (const c of cards) {
      c.x += c.vx * 0.004 * dt;
      c.y += c.vy * 0.003 * dt;
      if (c.y < 0.05) { c.y=0.05; c.vy=Math.abs(c.vy); }
      if (c.y > 0.92) { c.y=0.92; c.vy=-Math.abs(c.vy); }
      if (c.x < -0.15) Object.assign(c, spawnUndo());

      ctx.save();
      ctx.translate(c.x * lw, c.y * lh);
      ctx.rotate(c.rot);

      const cg = ctx.createLinearGradient(-c.w/2, -c.h/2, c.w/2, c.h/2);
      cg.addColorStop(0, `${c.color}${(c.alpha*0.85).toFixed(2)})`);
      cg.addColorStop(1, `${c.color}${(c.alpha*0.35).toFixed(2)})`);
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.roundRect(-c.w/2, -c.h/2, c.w, c.h, 4); ctx.fill();
      ctx.strokeStyle = `${c.color}0.55)`; ctx.lineWidth = 0.8; ctx.stroke();

      // Trailing lines (rightward = behind card)
      ctx.strokeStyle = `${c.color}${(c.alpha*0.18).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.w/2, 0);
      ctx.lineTo(c.w/2 + 18 + Math.abs(c.vx)*2.5, 0);
      ctx.stroke();

      ctx.restore();
    }

    // CCW orbit particles
    const cx2 = lw * 0.5, cy2 = lh * 0.5;
    for (const p of arcs) {
      p.angle += p.speed * dt;
      const px = cx2 + Math.cos(p.angle) * p.radius * Math.min(lw, lh);
      const py = cy2 + Math.sin(p.angle) * p.radius * Math.min(lw, lh);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.05 + p.angle * 3);
      ctx.beginPath();
      ctx.arc(px, py, p.size * (0.7 + 0.4 * pulse), 0, Math.PI*2);
      ctx.fillStyle = `${p.color}${(p.alpha*(0.4+0.6*pulse)).toFixed(2)})`;
      ctx.fill();
    }

    // Counter-clockwise ring
    const ringR = Math.min(lw,lh) * 0.22;
    const dashOffset = (t * 1.8) % 40; // moves CCW
    ctx.beginPath();
    ctx.arc(cx2, cy2, ringR, 0, Math.PI*2);
    ctx.strokeStyle = "rgba(148,0,211,0.18)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 32]);
    ctx.lineDashOffset = dashOffset;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  requestAnimationFrame(draw);
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
    if (isAnalyzing) return;
    dragCounter++;
    if (dragCounter === 1) showDropOverlay();
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (isAnalyzing) return;
    dragCounter--;
    if (dragCounter === 0) hideDropOverlay();
  });

  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragCounter = 0;
    hideDropOverlay();

    if (isSorting || isAnalyzing) return;

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
  if (isAnalyzing || isSorting) return;
  currentFolder = await window.api.chooseFolder();
  if (!currentFolder) { showEmptyState(); return; }
  await runPreview(currentFolder);
}

async function runPreview(folder) {
  isAnalyzing = true;
  _analysisCancelled = false;
  _etaStartTime = Date.now();
  const modeLabel = appMode === "sample" ? "samples" : "presets";

  // Show the animated analyzing canvas — replaces empty state or any prior content
  showAnalyzingState(modeLabel);
  statusText.innerText = appMode === "sample" ? "Analyzing samples…" : "Analyzing presets…";
  progressFill.style.width = "0%";

  window.api.onAnalyzeProgress(val => {
    if (_analysisCancelled) return;
    progressFill.style.width = val + "%";
    const eta = calcETA(val);
    statusText.innerText = `Analyzing ${modeLabel}… ${val}%${eta ? "  |  " + eta : ""}`;
    updateAnalyzingProgress(val, `${val}% — scanning files…${eta ? "  " + eta : ""}`);
  });

  try {
    if (appMode === "sample") {
      fullPreviewData = await window.api.samplePreview(folder, sampleIntelligenceMode);
    } else {
      fullPreviewData = await window.api.preview(folder);
    }
  } catch (err) {
    console.error(err);
    isAnalyzing = false;
    _analysisCancelled = false;
    stopAnalyzingState();
    progressFill.style.width = "0%";
    statusText.innerText = "Error analyzing folder.";
    showEmptyState("Error analyzing folder. Try again.");
    return;
  }

  // If the user cancelled while we were waiting for the IPC response, bail out.
  // _doResetSession() will already have cleaned up the UI.
  if (_analysisCancelled) {
    _analysisCancelled = false;
    isAnalyzing = false;
    return;
  }

  // Done — stop canvas, snap bar
  stopAnalyzingState();
  isAnalyzing = false;
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
// ================= SMART SEARCH =================
// Parses natural language queries like:
//   "128 bpm"  |  "128 bpm a min"  |  "138 bpm c drum loop"
//   "a minor"  |  "c# major"  |  "loop"  |  "one shot"  |  "dark pad"
// Returns a structured { bpm, key, minor, major, terms[] } object.
function parseSmartSearch(raw) {
  const q = raw.trim().toLowerCase();
  const result = { bpm: null, bpmTolerance: 2, key: null, minor: null, major: null, terms: [] };
  if (!q) return result;

  let working = q;

  // ── BPM: "128bpm" | "128 bpm" | "bpm128" ─────────────────────────────────
  working = working.replace(/(?:(\d{2,3})\s*bpm|bpm\s*(\d{2,3}))/gi, (_, a, b) => {
    result.bpm = parseInt(a || b);
    return " ";
  });
  // Bare number: treat as BPM only if >=40 and <=300 and no BPM parsed yet
  working = working.replace(/\b(\d{2,3})\b/g, (_, n) => {
    const v = parseInt(n);
    if (!result.bpm && v >= 40 && v <= 300) { result.bpm = v; return " "; }
    return n;
  });

  // ── Key + mode: "a min" | "c# major" | "am" | "f#m" | "bb minor" ─────────
  // Full-word "min"/"minor" / "maj"/"major" after a note letter
  working = working.replace(
    /\b([a-g](?:#|b)?)\s*(m(?:in(?:or)?)?|maj(?:or)?)\b/gi,
    (_, note, mode) => {
      result.key = note[0].toUpperCase() + (note.slice(1) || "");
      if (/^m(?:in)?/.test(mode.toLowerCase())) result.minor = true;
      else result.major = true;
      return " ";
    }
  );
  // Shorthand with trailing "m": "am" "c#m" "f#m" — only when not preceded by more letters
  if (!result.key) {
    working = working.replace(/\b([a-g](?:#|b)?)m\b/gi, (_, note) => {
      result.key = note[0].toUpperCase() + (note.slice(1) || "");
      result.minor = true;
      return " ";
    });
  }
  // Bare note with no mode — just key filter
  if (!result.key) {
    working = working.replace(/\b([a-g](?:#|b)?)\b/gi, (_, note) => {
      result.key = note[0].toUpperCase() + (note.slice(1) || "");
      return " ";
    });
  }

  // ── Leftover "minor" / "major" words (without a note) ─────────────────────
  working = working.replace(/\bminor\b/gi, () => { if (result.minor === null) result.minor = true;  return " "; });
  working = working.replace(/\bmajor\b/gi, () => { if (result.major === null) result.major = true;  return " "; });
  working = working.replace(/\bmin\b/gi,   () => { if (result.minor === null) result.minor = true;  return " "; });
  working = working.replace(/\bmaj\b/gi,   () => { if (result.major === null) result.major = true;  return " "; });

  // ── Remaining words → free-text terms ─────────────────────────────────────
  result.terms = working.split(/\s+/).map(t => t.trim()).filter(t => t.length > 1);

  return result;
}

// Tests a single preview item against the parsed search token set.
function matchesSmartSearch(item, parsed) {
  // ── BPM match (±tolerance) ─────────────────────────────────────────────────
  if (parsed.bpm !== null) {
    const rawBpm = parseFloat(
      (appMode === "sample" ? item.metadata?.bpm : item.intelligence?.bpm) || 0
    );
    if (rawBpm <= 0) return false; // no BPM data → exclude
    const diff = Math.abs(Math.round(rawBpm) - parsed.bpm);
    if (diff > parsed.bpmTolerance) return false;
  }

  // ── Key match ──────────────────────────────────────────────────────────────
  if (parsed.key !== null) {
    const rawKey = (
      appMode === "sample" ? (item.metadata?.key || "") : (item.intelligence?.key || "")
    ).trim();
    if (!rawKey) return false;
    const normKey = rawKey[0].toUpperCase() + rawKey.slice(1).toLowerCase();
    // Strip trailing 'm' for note comparison
    const itemNote = normKey.replace(/m$/, "");
    const searchNote = parsed.key.replace(/b$/, "♭"); // normalise 'b' flat indicator
    // Simple string compare on base note (handles C, C#, Bb etc.)
    const parsedNote = parsed.key[0].toUpperCase() + (parsed.key.slice(1) || "");
    if (!itemNote.toUpperCase().startsWith(parsedNote.toUpperCase())) return false;
  }

  // ── Mode match (minor/major) ───────────────────────────────────────────────
  if (parsed.minor === true || parsed.major === true) {
    const rawKey = (
      appMode === "sample" ? (item.metadata?.key || "") : (item.intelligence?.key || "")
    ).trim();
    const mood = (
      appMode === "sample" ? (item.metadata?.mood || "") : (item.intelligence?.mood || "")
    ).trim().toLowerCase();
    const normKey = rawKey ? rawKey[0].toUpperCase() + rawKey.slice(1).toLowerCase() : "";
    const isMinor = normKey.endsWith("m") || mood === "minor";
    if (parsed.minor === true  && !isMinor) return false;
    if (parsed.major === true  &&  isMinor) return false;
  }

  // ── Free-text terms: match against filename, category, metadata ────────────
  if (parsed.terms.length > 0) {
    // Build a single searchable string for the item
    const haystack = [
      item.file || "",
      item.category || "",
      item.sampleType || "",
      item.metadata?.mood || "",
      item.intelligence?.mood || "",
      item.synth || "",
    ].join(" ").toLowerCase();

    for (const term of parsed.terms) {
      if (!haystack.includes(term)) return false;
    }
  }

  return true;
}

// Called by the search input — debounced so we don't re-render on every keystroke
function onPreviewSearch(value) {
  previewSearchQuery = value;
  if (_previewSearchTimer !== null) clearTimeout(_previewSearchTimer);
  _previewSearchTimer = setTimeout(() => {
    _previewSearchTimer = null;
    applyFilter();
  }, 150);
}

// Clears the search box and resets the query
function clearPreviewSearch() {
  previewSearchQuery = "";
  const inp = document.getElementById("previewSearchInput");
  if (inp) inp.value = "";
  applyFilter();
}

function applyFilter() {
  const enabled = getEnabledCategories();

  filteredPreviewData = !enabled.length
    ? []
    : fullPreviewData.filter(item => {
        if (!enabled.includes(item.category)) return false;

        // BPM range filter (works for both modes if bpm data available)
        // Round to integer — BPM metadata is often stored as float (e.g. 112.9)
        // and we want "112 BPM" displayed files to match a 112–112 range exactly.
        // When the user has set a non-default BPM range, files with NO BPM data
        // are also excluded — they can't be confirmed to be in the requested range.
        const bpmRaw = parseFloat(
          (appMode === "sample" ? item.metadata?.bpm : item.intelligence?.bpm) || 0
        );
        const bpmIsFiltered = bpmRange.min > 0 || bpmRange.max < 300;
        if (bpmIsFiltered) {
          if (bpmRaw <= 0) return false; // no BPM data → exclude when a range is active
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

        // ── Smart search (preview pane search bar) ─────────────────────────
        if (previewSearchQuery.trim()) {
          const parsed = parseSmartSearch(previewSearchQuery);
          if (!matchesSmartSearch(item, parsed)) return false;
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
// ── Audio play button helper ──────────────────────────────────────────────────
/**
 * makeRowNameCell – returns a flex container with:
 *   [● play icon] [filename text] [📂 locate btn]
 * Clicking the icon or anywhere on the name text plays the audio.
 * The locate button (visible on row hover via CSS) opens Windows Explorer.
 */
function makeRowNameCell(preset, displayName) {
  const cell = document.createElement("div");
  cell.className = "row-name-cell";

  if (audioPlayer.isAudio(preset)) {
    // ── Clickable play area (icon + name) ─────────────────────────
    const playArea = document.createElement("div");
    playArea.className = "row-play-area" + (audioPlayer.isPlayingItem(preset.from) ? " is-playing" : "");
    playArea.dataset.from = preset.from; // used by _refreshAllRowBtns

    const icon = document.createElement("span");
    icon.className = "row-play-icon";
    icon.dataset.from = preset.from;
    icon.textContent = audioPlayer.isPlayingItem(preset.from) ? "■" : "▶";
    icon.setAttribute("aria-label", "Play / Stop audio");
    playArea.appendChild(icon);

    const nameSpan = document.createElement("span");
    nameSpan.className = "row-file-name";
    nameSpan.textContent = displayName;
    nameSpan.title = preset.from;
    playArea.appendChild(nameSpan);

    playArea.addEventListener("click", e => {
      e.stopPropagation();
      if (audioPlayer.isLoadedItem(preset.from)) audioPlayer.togglePlay();
      else audioPlayer.play(preset);
    });

    cell.appendChild(playArea);
  } else {
    // Non-audio: just show the name
    const nameSpan = document.createElement("span");
    nameSpan.className = "row-file-name";
    nameSpan.textContent = displayName;
    nameSpan.title = preset.from;
    nameSpan.style.padding = "2px 3px";
    cell.appendChild(nameSpan);
  }

  // ── Locate button (always present, revealed on hover via CSS) ──
  if (window.api?.showInFolder) {
    const locBtn = document.createElement("button");
    locBtn.className = "row-locate-btn";
    locBtn.title = "Show in Windows Explorer";
    locBtn.textContent = "📂";
    locBtn.addEventListener("click", e => {
      e.stopPropagation();
      window.api.showInFolder(preset.from);
    });
    cell.appendChild(locBtn);
  }

  return cell;
}

function _fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildSampleTagsWrap(preset) {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:inline-flex; align-items:center; gap:3px; flex-shrink:0;";

  // Duplicate warning badge (highest priority — very visible)
  if (preset.isDuplicate) {
    const dupBadge = document.createElement("span");
    const isExact   = preset.duplicateType === "exact";
    const willSkip  = isExact && !preset.isKeptCopy && skipDuplicates;
    dupBadge.className = `duplicate-badge${willSkip ? " dup-skipped" : ""}`;
    dupBadge.textContent = isExact ? "⚠ DUP" : "⚠ VARIANT";
    dupBadge.title = isExact
      ? (willSkip
          ? "Exact duplicate (same name & size) — will be skipped during sort"
          : preset.isKeptCopy
            ? "Exact duplicate — this copy will be kept"
            : "Exact duplicate (same name & size). Enable 'Skip exact duplicates' to exclude.")
      : "Same filename but different file size — likely a different version. Will be renamed with (1), (2) suffix.";
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

  // ── Show/hide search bar based on data availability ───────────────────────
  const searchBar = document.getElementById("previewSearchBar");
  if (searchBar) {
    searchBar.style.display = fullPreviewData.length > 0 ? "block" : "none";
  }

  // ── Update clear button visibility ────────────────────────────────────────
  const clearBtn = document.getElementById("previewSearchClearBtn");
  if (clearBtn) clearBtn.style.display = previewSearchQuery.trim() ? "inline-block" : "none";

  // ── Update search hint text ───────────────────────────────────────────────
  const hintEl = document.getElementById("previewSearchHint");
  if (hintEl) {
    if (previewSearchQuery.trim()) {
      const parsed = parseSmartSearch(previewSearchQuery);
      const total  = fullPreviewData.length;
      const shown  = filteredPreviewData.length;
      const tokens = [];
      if (parsed.bpm !== null)    tokens.push(`<span class="sh-token">BPM ${parsed.bpm}±${parsed.bpmTolerance}</span>`);
      if (parsed.key !== null)    tokens.push(`<span class="sh-token">Key ${parsed.key}${parsed.minor ? "m" : parsed.major ? " maj" : ""}</span>`);
      else if (parsed.minor)      tokens.push(`<span class="sh-token">Minor</span>`);
      else if (parsed.major)      tokens.push(`<span class="sh-token">Major</span>`);
      parsed.terms.forEach(t =>  tokens.push(`<span class="sh-token">"${t}"</span>`));
      const tokenStr = tokens.length ? `  ·  ${tokens.join("  ")}` : "";
      hintEl.innerHTML = `<span class="sh-match">${shown}</span> of ${total} files${tokenStr}`;
    } else {
      hintEl.innerHTML = "";
    }
  }

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

  // Duplicate count warning + skip toggle
  const exactDups   = filteredPreviewData.filter(p => p.isDuplicate && p.duplicateType === "exact" && !p.isKeptCopy);
  const variantDups = filteredPreviewData.filter(p => p.isDuplicate && p.duplicateType === "variant");
  const dupCount    = filteredPreviewData.filter(p => p.isDuplicate).length;

  if (dupCount > 0) {
    const dupWrap = document.createElement("div");
    dupWrap.style.cssText = `display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;`;

    // ── Warning badge ──────────────────────────────────────────────────────
    const dupWarn = document.createElement("span");
    dupWarn.style.cssText = `
      display:inline-flex; align-items:center; gap:4px;
      padding:3px 9px; border-radius:6px; font-size:11px; font-weight:600;
      background:rgba(255,165,0,0.15); color:#ffaa33;
      border:1px solid rgba(255,165,0,0.35);
      cursor:default;
    `;

    let warnTitle = "";
    if (exactDups.length > 0 && variantDups.length > 0) {
      warnTitle = `${exactDups.length} exact duplicate${exactDups.length > 1 ? "s" : ""} (identical name & size) and ${variantDups.length} name collision${variantDups.length > 1 ? "s" : ""} (same name, different size — likely different versions).`;
    } else if (exactDups.length > 0) {
      warnTitle = `${exactDups.length} exact duplicate${exactDups.length > 1 ? "s" : ""} found (same filename & file size). Enable "Skip Duplicates" to exclude them from the sort.`;
    } else {
      warnTitle = `${variantDups.length} name collision${variantDups.length > 1 ? "s" : ""} — files share a name but have different sizes (likely different versions). They will be renamed with a (1), (2) suffix.`;
    }
    dupWarn.title = warnTitle;
    dupWarn.classList.add("dup-warn-clickable");
    dupWarn.onclick = () => openDupManager();

    let warnLabel = `⚠ ${dupCount} duplicate${dupCount > 1 ? "s" : ""}`;
    if (exactDups.length > 0 && variantDups.length > 0) {
      warnLabel = `⚠ ${exactDups.length} exact · ${variantDups.length} variant`;
    }
    dupWarn.textContent = warnLabel;
    dupWrap.appendChild(dupWarn);

    // ── "Skip exact duplicates" checkbox — only show when exact dups exist ──
    if (exactDups.length > 0) {
      const label = document.createElement("label");
      label.style.cssText = `
        display:inline-flex; align-items:center; gap:5px;
        font-size:11px; font-weight:500; color:#ccc;
        cursor:pointer; user-select:none;
        padding:3px 8px; border-radius:6px;
        background:rgba(255,255,255,0.05);
        border:1px solid rgba(255,255,255,0.1);
        transition: background 0.15s;
      `;
      label.title = `When checked, ${exactDups.length} exact duplicate${exactDups.length > 1 ? "s" : ""} (same name + same file size) will be excluded from the sort. Only the first copy will be kept.`;
      label.onmouseenter = () => { label.style.background = "rgba(148,0,211,0.18)"; label.style.borderColor = "rgba(148,0,211,0.5)"; };
      label.onmouseleave = () => { label.style.background = "rgba(255,255,255,0.05)"; label.style.borderColor = "rgba(255,255,255,0.1)"; };

      const cb = document.createElement("input");
      cb.type    = "checkbox";
      cb.checked = skipDuplicates;
      cb.style.cssText = `
        width:14px; height:14px; cursor:pointer;
        accent-color: #9400D3;
      `;
      cb.onchange = () => {
        skipDuplicates = cb.checked;
        // Re-render preview header so the duplicate count updates live
        renderPreview();
      };

      const cbText = document.createElement("span");
      cbText.textContent = "Skip exact duplicates";

      label.appendChild(cb);
      label.appendChild(cbText);
      dupWrap.appendChild(label);

      // Live count hint when enabled
      if (skipDuplicates) {
        const hint = document.createElement("span");
        hint.style.cssText = `font-size:10px; color:#888; font-style:italic;`;
        hint.textContent = `(${exactDups.length} file${exactDups.length > 1 ? "s" : ""} will be skipped)`;
        dupWrap.appendChild(hint);
      }
    }

    leftBtns.appendChild(dupWrap);
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

        const displayName = appMode === "sample" ? stripDisplayExtension(preset.file) : preset.file;

        if (appMode === "sample") {
          // ── Sample: big play-prefix name cell ───────────────────────────
          row.appendChild(makeRowNameCell(preset, displayName));
        } else {
          // ── Preset: plain name + small play btn if audio ─────────────────
          const nameSpan = document.createElement("span");
          nameSpan.textContent = displayName;
          nameSpan.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
          row.appendChild(nameSpan);
          // Small play btn for audio presets (keep original style)
          if (audioPlayer.isAudio(preset)) {
            const btn = document.createElement("button");
            btn.className = "row-play-btn" + (audioPlayer.isPlayingItem(preset.from) ? " is-playing" : "");
            btn.dataset.from = preset.from;
            btn.title = "Preview audio";
            btn.textContent = audioPlayer.isPlayingItem(preset.from) ? "■" : "▶";
            btn.style.cssText = "background:none;border:1px solid rgba(148,0,211,0.4);color:#b06be0;border-radius:3px;font-size:10px;padding:1px 5px;cursor:pointer;flex-shrink:0;line-height:1.4;transition:background .15s,color .15s;";
            btn.addEventListener("click", e => { e.stopPropagation(); audioPlayer.isLoadedItem(preset.from) ? audioPlayer.togglePlay() : audioPlayer.play(preset); });
            row.appendChild(btn);
          }
        }

        if (appMode === "sample") {
          const tagsWrap = buildSampleTagsWrap(preset);
          row.appendChild(tagsWrap);
        } else {
          const tagsWrap = document.createElement("span");
          tagsWrap.style.cssText = "display:inline-flex; align-items:center; gap:3px; flex-shrink:0;";
          if (preset.isDuplicate) {
            const dupBadge = document.createElement("span");
            const isExact  = preset.duplicateType === "exact";
            const willSkip = isExact && !preset.isKeptCopy && skipDuplicates;
            dupBadge.className = `duplicate-badge${willSkip ? " dup-skipped" : ""}`;
            dupBadge.textContent = isExact ? "⚠ DUP" : "⚠ VARIANT";
            dupBadge.title = isExact
              ? (willSkip ? "Exact duplicate — will be skipped during sort" : preset.isKeptCopy ? "Exact duplicate — this copy will be kept" : "Exact duplicate (same name & size). Enable 'Skip exact duplicates' to exclude.")
              : "Same name, different size — likely a different version. Will be renamed with (1), (2) suffix.";
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

        if (appMode === "sample") {
          // Sample mode: use the shared name cell (play icon + filename + locate btn)
          const nameCell = makeRowNameCell(preset, stripDisplayExtension(preset.file));
          nameCell.style.cssText = "width:100%; overflow:hidden;";
          chip.appendChild(nameCell);
        } else {
          // Preset mode: plain name span + optional inline play button for audio presets
          const nameSpan = document.createElement("span");
          nameSpan.textContent = stripDisplayExtension(preset.file);
          nameSpan.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;";
          chip.appendChild(nameSpan);

          if (audioPlayer.isAudio(preset)) {
            const btn = document.createElement("button");
            btn.className = "row-play-btn" + (audioPlayer.isPlayingItem(preset.from) ? " is-playing" : "");
            btn.dataset.from = preset.from;
            btn.title = "Preview audio";
            btn.textContent = audioPlayer.isPlayingItem(preset.from) ? "■" : "▶";
            btn.style.cssText = "background:none;border:1px solid rgba(148,0,211,0.4);color:#b06be0;border-radius:3px;font-size:10px;padding:1px 5px;cursor:pointer;flex-shrink:0;line-height:1.4;transition:background .15s,color .15s;";
            btn.addEventListener("click", e => { e.stopPropagation(); audioPlayer.isLoadedItem(preset.from) ? audioPlayer.togglePlay() : audioPlayer.play(preset); });
            chip.appendChild(btn);
          }
        }

        if (appMode === "sample") {
          const tagsWrap = buildSampleTagsWrap(preset);
          tagsWrap.style.cssText = "display:flex; flex-wrap:wrap; gap:3px; align-items:center;";
          chip.appendChild(tagsWrap);
        } else {
          if (preset.isDuplicate) {
            const dupBadge = document.createElement("span");
            const isExact  = preset.duplicateType === "exact";
            const willSkip = isExact && !preset.isKeptCopy && skipDuplicates;
            dupBadge.className = `duplicate-badge${willSkip ? " dup-skipped" : ""}`;
            dupBadge.textContent = isExact ? "⚠ DUP" : "⚠ VARIANT";
            dupBadge.title = isExact
              ? (willSkip ? "Exact duplicate — will be skipped during sort" : preset.isKeptCopy ? "Exact duplicate — this copy will be kept" : "Exact duplicate (same name & size). Enable 'Skip exact duplicates' to exclude.")
              : "Same name, different size — likely a different version.";
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
          // Sample mode: play-prefix name on top, tags row below
          row.style.cssText = "display:flex; flex-direction:column; gap:3px; padding:5px 8px;";

          // Name cell with play prefix + locate btn
          const nameCell = makeRowNameCell(preset, stripDisplayExtension(preset.file));
          row.appendChild(nameCell);

          const tagsWrap = buildSampleTagsWrap(preset);
          tagsWrap.style.cssText = "display:flex; flex-wrap:wrap; gap:3px; padding-left:2px;";
          row.appendChild(tagsWrap);
        } else {
          row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:6px;";
          const nameSpan = document.createElement("span");
          nameSpan.textContent = stripDisplayExtension(preset.file);
          nameSpan.style.cssText = "flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
          row.appendChild(nameSpan);

          // Small play btn for audio presets in columns view
          if (audioPlayer.isAudio(preset)) {
            const btn = document.createElement("button");
            btn.className = "row-play-btn" + (audioPlayer.isPlayingItem(preset.from) ? " is-playing" : "");
            btn.dataset.from = preset.from;
            btn.title = "Preview audio";
            btn.textContent = audioPlayer.isPlayingItem(preset.from) ? "■" : "▶";
            btn.style.cssText = "background:none;border:1px solid rgba(148,0,211,0.4);color:#b06be0;border-radius:3px;font-size:10px;padding:1px 5px;cursor:pointer;flex-shrink:0;line-height:1.4;transition:background .15s,color .15s;";
            btn.addEventListener("click", e => { e.stopPropagation(); audioPlayer.isLoadedItem(preset.from) ? audioPlayer.togglePlay() : audioPlayer.play(preset); });
            row.appendChild(btn);
          }

          const colTagsC = document.createElement("span");
          colTagsC.style.cssText = "display:inline-flex; align-items:center; gap:3px; flex-shrink:0;";
          if (preset.isDuplicate) {
            const dupBadge = document.createElement("span");
            const isExact  = preset.duplicateType === "exact";
            const willSkip = isExact && !preset.isKeptCopy && skipDuplicates;
            dupBadge.className = `duplicate-badge${willSkip ? " dup-skipped" : ""}`;
            dupBadge.textContent = isExact ? "⚠ DUP" : "⚠ VARIANT";
            dupBadge.title = isExact
              ? (willSkip ? "Exact duplicate — will be skipped during sort" : preset.isKeptCopy ? "Exact duplicate — this copy will be kept" : "Exact duplicate (same name & size). Enable 'Skip exact duplicates' to exclude.")
              : "Same name, different size — likely a different version.";
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

// =============================================================================
// ================= DUPLICATES MANAGER MODAL ==================================
// =============================================================================
// State managed entirely within the modal — changes only take effect when
// the user clicks "Apply & Close". Until then, fullPreviewData is unchanged.

let dupManagerTab = "exact"; // "exact" | "variant"
// Map from preset.from (file path) → true if the user wants to INCLUDE it in sort
// Populated fresh each time the modal opens from current fullPreviewData state.
const dupIncludeMap = new Map();
// Track files scheduled for permanent deletion (confirmed inside modal)
const dupDeletedPaths = new Set();

/** Format bytes to human-readable size string */
function formatBytes(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024)       return bytes + " B";
  if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(2) + " MB";
}

/**
 * Build duplicate groups from fullPreviewData.
 * Returns { exact: [ [item, item, ...], ... ], variant: [ [...], ... ] }
 * Each sub-array is a group of files sharing the same lowercase filename.
 */
function buildDupGroups() {
  const byName = {};
  for (const item of fullPreviewData) {
    if (!item.isDuplicate) continue;
    const key = item.file.toLowerCase();
    if (!byName[key]) byName[key] = [];
    byName[key].push(item);
  }

  const exact = [], variant = [];
  for (const items of Object.values(byName)) {
    if (!items.length) continue;
    const type = items[0].duplicateType;
    if (type === "exact") exact.push(items);
    else variant.push(items);
  }

  // Sort groups alphabetically by filename
  exact.sort((a, b) => a[0].file.localeCompare(b[0].file));
  variant.sort((a, b) => a[0].file.localeCompare(b[0].file));
  return { exact, variant };
}

/** Open the Duplicates Manager modal */
function openDupManager() {
  const overlay = document.getElementById("dupManagerOverlay");
  if (!overlay) return;

  // Initialise include map: default = include all (except non-kept exact dups if skipDuplicates)
  dupIncludeMap.clear();
  dupDeletedPaths.clear();
  for (const item of fullPreviewData) {
    if (!item.isDuplicate) continue;
    // Default: if skipDuplicates is on, non-kept exact dups start unchecked
    const defaultInclude = !(skipDuplicates && item.duplicateType === "exact" && !item.isKeptCopy);
    dupIncludeMap.set(item.from, defaultInclude);
  }

  dupManagerTab = "exact";
  overlay.classList.add("visible");
  overlay.onclick = (e) => { if (e.target === overlay) closeDupManager(); };
  document._dupEscHandler = (e) => { if (e.key === "Escape") closeDupManager(); };
  document.addEventListener("keydown", document._dupEscHandler);

  renderDupManager();
}

function closeDupManager() {
  const overlay = document.getElementById("dupManagerOverlay");
  if (overlay) overlay.classList.remove("visible");
  if (document._dupEscHandler) {
    document.removeEventListener("keydown", document._dupEscHandler);
    delete document._dupEscHandler;
  }
}

/** Apply the modal's include/exclude choices back into fullPreviewData, then re-render preview */
function applyDupManagerSelections() {
  // Remove permanently-deleted files from fullPreviewData
  if (dupDeletedPaths.size > 0) {
    fullPreviewData = fullPreviewData.filter(p => !dupDeletedPaths.has(p.from));
  }

  // Sync include/exclude selections: items marked excluded get flagged so
  // dataToSort (in startSort) can honour them. We reuse isDuplicate + a new
  // manuallyExcluded flag rather than mutating isDuplicate semantics.
  for (const item of fullPreviewData) {
    if (!item.isDuplicate) continue;
    const include = dupIncludeMap.get(item.from);
    item.manuallyExcluded = (include === false);
  }

  // Also keep skipDuplicates in sync: if user has individually deselected any exact dup,
  // make sure startSort respects manuallyExcluded regardless of the checkbox
  closeDupManager();

  // Re-run applyFilter so filteredPreviewData reflects deletions & exclusions
  applyFilter();
}

/** Render tabs, toolbar and file groups inside the modal */
/** Render tabs, toolbar, explainer and file groups inside the modal */
function renderDupManager() {
  const groups = buildDupGroups();
  const subEl      = document.getElementById("dupManagerSub");
  const tabsEl     = document.getElementById("dupManagerTabs");
  const explEl     = document.getElementById("dupManagerExplainer");
  const toolbarEl  = document.getElementById("dupManagerToolbar");
  const bodyEl     = document.getElementById("dupManagerBody");

  if (!subEl || !tabsEl || !toolbarEl || !bodyEl) return;

  const totalExact   = groups.exact.reduce((s, g) => s + g.length, 0);
  const totalVariant = groups.variant.reduce((s, g) => s + g.length, 0);

  // Friendly subtitle
  const exactSets   = groups.exact.length;
  const variantSets = groups.variant.length;
  subEl.textContent =
    `Found ${exactSets} set${exactSets !== 1 ? "s" : ""} of exact copies` +
    ` · ${variantSets} set${variantSets !== 1 ? "s" : ""} with same name, different content`;

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabsEl.innerHTML = "";

  const tabs = [
    { id: "exact",   emoji: "🔴", label: "Exact Copies",          count: exactSets   },
    { id: "variant", emoji: "🟡", label: "Same Name, Different File", count: variantSets },
  ];

  tabs.forEach(t => {
    const btn = document.createElement("button");
    btn.className = `dup-tab${dupManagerTab === t.id ? " active" : ""}`;
    btn.innerHTML = `${t.emoji} ${t.label} <span style="opacity:0.6;font-weight:400;margin-left:4px;">(${t.count})</span>`;
    btn.onclick = () => { dupManagerTab = t.id; renderDupManager(); };
    tabsEl.appendChild(btn);
  });

  // ── Explainer banner ──────────────────────────────────────────────────────
  if (explEl) {
    explEl.innerHTML = "";
    const banner = document.createElement("div");
    banner.className = "dup-explainer";

    if (dupManagerTab === "exact") {
      banner.innerHTML = `
        <strong>These files are byte-for-byte identical</strong> — same filename, same size, same content.
        The <span style="color:#30e870;font-weight:600;">KEEP</span> badge marks the first copy found.
        All other copies are checked by default and will be sorted too, unless you uncheck them or delete them.
        <div class="dup-explainer-tip">Tip: Click <em>"✂ Keep First Copy Only"</em> to automatically uncheck all extras — then sort or delete them.</div>
      `;
    } else {
      banner.innerHTML = `
        <strong>These files share a filename but are different sizes</strong>, so they are probably different versions of the same sample.
        All copies are checked and will be sorted. During sort, each copy gets a number added automatically (e.g. <em>Kick (1).wav, Kick (2).wav</em>).
        <div class="dup-explainer-tip">Tip: Uncheck any version you don't need, or click <em>"📂 Open Folder"</em> to listen and compare before deciding.</div>
      `;
    }
    explEl.appendChild(banner);
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  toolbarEl.innerHTML = "";
  const currentGroups = groups[dupManagerTab] || [];
  const currentItems  = currentGroups.flat().filter(p => !dupDeletedPaths.has(p.from));

  // Include All / Exclude All
  const selAllBtn = document.createElement("button");
  selAllBtn.className = "dup-toolbar-btn";
  selAllBtn.textContent = "✓ Check All";
  selAllBtn.title = "Mark all files as included in sort";
  selAllBtn.onclick = () => { currentItems.forEach(p => dupIncludeMap.set(p.from, true)); renderDupManager(); };
  toolbarEl.appendChild(selAllBtn);

  const deselAllBtn = document.createElement("button");
  deselAllBtn.className = "dup-toolbar-btn";
  deselAllBtn.textContent = "✕ Uncheck All";
  deselAllBtn.title = "Mark all files as skipped (they won't be sorted)";
  deselAllBtn.onclick = () => { currentItems.forEach(p => dupIncludeMap.set(p.from, false)); renderDupManager(); };
  toolbarEl.appendChild(deselAllBtn);

  if (dupManagerTab === "exact") {
    const sep1 = document.createElement("div"); sep1.className = "dup-toolbar-sep"; toolbarEl.appendChild(sep1);

    const keepFirstBtn = document.createElement("button");
    keepFirstBtn.className = "dup-toolbar-btn";
    keepFirstBtn.title = "Keep the first copy of each group checked. Uncheck all extra copies.";
    keepFirstBtn.textContent = "✂ Keep First Copy Only";
    keepFirstBtn.onclick = () => {
      currentGroups.forEach(group => {
        group.filter(p => !dupDeletedPaths.has(p.from)).forEach((p, idx) => {
          dupIncludeMap.set(p.from, idx === 0);
        });
      });
      renderDupManager();
    };
    toolbarEl.appendChild(keepFirstBtn);

    const sep2 = document.createElement("div"); sep2.className = "dup-toolbar-sep"; toolbarEl.appendChild(sep2);

    const delExtraBtn = document.createElement("button");
    delExtraBtn.className = "dup-toolbar-btn danger";
    delExtraBtn.title = "Permanently delete all extra copies — only the first copy of each group is kept on disk";
    delExtraBtn.textContent = "🗑 Delete All Extras";
    delExtraBtn.onclick = async () => {
      const toDelete = currentGroups.flatMap(group =>
        group.filter(p => !dupDeletedPaths.has(p.from)).filter((_, idx) => idx > 0)
      );
      if (!toDelete.length) return;
      if (!confirm(
        `This will permanently delete ${toDelete.length} file${toDelete.length > 1 ? "s" : ""} from your hard drive.\n\n` +
        `Only the first copy of each group will be kept.\n\nThis cannot be undone. Continue?`
      )) return;
      for (const p of toDelete) {
        const res = await window.api.deleteFile(p.from);
        if (res.success) { dupDeletedPaths.add(p.from); dupIncludeMap.delete(p.from); }
      }
      renderDupManager();
    };
    toolbarEl.appendChild(delExtraBtn);
  }

  // Count chip (right-aligned)
  const includedCount = currentItems.filter(p => dupIncludeMap.get(p.from) !== false).length;
  const countChip = document.createElement("span");
  countChip.className = "dup-selected-count";
  countChip.textContent = `${includedCount} / ${currentItems.length} will be sorted`;
  countChip.title = "Files that are checked will be included when you click Start Sort";
  toolbarEl.appendChild(countChip);

  // ── Body: group cards ─────────────────────────────────────────────────────
  bodyEl.innerHTML = "";

  if (currentGroups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dup-empty";
    empty.innerHTML = dupManagerTab === "exact"
      ? `<div style="font-size:28px;margin-bottom:8px;">✅</div>No exact copies found.<div style="font-size:11px;margin-top:4px;opacity:0.7;">Every file has a unique name and size.</div>`
      : `<div style="font-size:28px;margin-bottom:8px;">✅</div>All filenames are unique.<div style="font-size:11px;margin-top:4px;opacity:0.7;">No files share the same name.</div>`;
    bodyEl.appendChild(empty);
    return;
  }

  currentGroups.forEach(group => {
    const liveGroup = group.filter(p => !dupDeletedPaths.has(p.from));
    if (!liveGroup.length) return;

    const card = document.createElement("div");
    card.className = "dup-group";

    // Group header
    const header = document.createElement("div");
    header.className = "dup-group-header";

    const nameEl = document.createElement("span");
    nameEl.className = "dup-group-name";
    nameEl.title = group[0].file;
    nameEl.textContent = group[0].file;
    header.appendChild(nameEl);

    const countEl = document.createElement("span");
    countEl.style.cssText = "font-size:10px; color:var(--text-dim); flex-shrink:0;";
    countEl.textContent = `${liveGroup.length} cop${liveGroup.length !== 1 ? "ies" : "y"}`;
    header.appendChild(countEl);

    const typeBadge = document.createElement("span");
    typeBadge.className = `dup-group-type-badge ${dupManagerTab}`;
    typeBadge.title = dupManagerTab === "exact"
      ? "Byte-for-byte identical files"
      : "Same filename but different content / size";
    typeBadge.textContent = dupManagerTab === "exact" ? "IDENTICAL" : "SAME NAME";
    header.appendChild(typeBadge);

    card.appendChild(header);

    // File rows
    liveGroup.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "dup-file-row";
      const isIncluded = dupIncludeMap.get(item.from) !== false;
      if (!isIncluded) row.classList.add("excluded");

      // Checkbox
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "dup-file-check";
      cb.checked = isIncluded;
      cb.title = isIncluded
        ? "Checked — will be sorted. Click to skip this file."
        : "Unchecked — will be skipped. Click to include this file.";
      cb.onchange = () => {
        dupIncludeMap.set(item.from, cb.checked);
        cb.title = cb.checked
          ? "Checked — will be sorted. Click to skip this file."
          : "Unchecked — will be skipped. Click to include this file.";
        row.classList.toggle("excluded", !cb.checked);
        const live2  = currentGroups.flat().filter(p => !dupDeletedPaths.has(p.from));
        const inc2   = live2.filter(p => dupIncludeMap.get(p.from) !== false).length;
        countChip.textContent = `${inc2} / ${live2.length} will be sorted`;
      };
      row.appendChild(cb);

      // File info
      const info = document.createElement("div");
      info.className = "dup-file-info";

      const nameSpan = document.createElement("div");
      nameSpan.className = "dup-file-name";
      nameSpan.textContent = item.file;
      info.appendChild(nameSpan);

      const pathSpan = document.createElement("div");
      pathSpan.className = "dup-file-path";
      pathSpan.textContent = item.from;
      pathSpan.title = "Full path: " + item.from;
      info.appendChild(pathSpan);

      row.appendChild(info);

      // File size
      const sizeEl = document.createElement("div");
      sizeEl.className = "dup-file-size";
      sizeEl.textContent = formatBytes(item.size);
      sizeEl.title = "File size";
      row.appendChild(sizeEl);

      // KEEP badge (first in exact group)
      if (dupManagerTab === "exact" && idx === 0) {
        const keptBadge = document.createElement("span");
        keptBadge.className = "dup-kept-badge";
        keptBadge.textContent = "KEEP";
        keptBadge.title = "This is the first copy found — it will be kept by default";
        row.appendChild(keptBadge);
      }

      // Action buttons
      const actions = document.createElement("div");
      actions.className = "dup-file-actions";

      const locateBtn = document.createElement("button");
      locateBtn.className = "dup-action-btn locate";
      locateBtn.textContent = "📂 Open Folder";
      locateBtn.title = "Highlight this file in Windows Explorer";
      locateBtn.onclick = () => window.api.showInFolder(item.from);
      actions.appendChild(locateBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "dup-action-btn delete-btn";
      deleteBtn.textContent = "🗑 Delete";
      deleteBtn.title = "Permanently delete this file from your hard drive (cannot be undone)";
      deleteBtn.onclick = async () => {
        if (!confirm(`Permanently delete this file?\n\n${item.from}\n\nThis cannot be undone.`)) return;
        const res = await window.api.deleteFile(item.from);
        if (res.success) {
          dupDeletedPaths.add(item.from);
          dupIncludeMap.delete(item.from);
          renderDupManager();
        } else {
          alert(`Could not delete the file:\n${res.error}`);
        }
      };
      actions.appendChild(deleteBtn);

      row.appendChild(actions);
      card.appendChild(row);
    });

    bodyEl.appendChild(card);
  });
}

// ================= START SORT =================
async function startSort() {
  if (!filteredPreviewData.length || isSorting) return;

  isSorting = true;
  progressFill.style.width = "0%";

  // Exclude files based on:
  // 1. skipDuplicates checkbox (auto-excludes non-kept exact dups)
  // 2. manuallyExcluded flag set by the Duplicates Manager modal
  const dataToSort = filteredPreviewData.filter(p => {
    if (p.manuallyExcluded) return false;
    if (skipDuplicates && p.isDuplicate && p.duplicateType === "exact" && !p.isKeptCopy) return false;
    return true;
  });

  // Show the sort animation
  showSortingAnimation(dataToSort.length);
  statusText.innerText = `Sorting ${dataToSort.length} files…`;
  _etaStartTime = Date.now();

  window.api.onProgress(val => {
    progressFill.style.width = val + "%";
    const eta = calcETA(val);
    if (eta) statusText.innerText = `Sorting ${dataToSort.length} files…  |  ${eta}`;
    updateSortProgress(val, eta);
  });

  try {
    let result;
    if (appMode === "sample") {
      result = await window.api.sampleExecute(
        currentFolder,
        dataToSort,
        { mode: keyFilter.mode, notes: [...keyFilter.notes] },
        { min: bpmRange.min, max: bpmRange.max }
      );
    } else {
      result = await window.api.execute(
        currentFolder,
        dataToSort,
        { mode: keyFilter.mode, notes: [...keyFilter.notes] },
        { min: bpmRange.min, max: bpmRange.max }
      );
    }
    const count = (typeof result === "object") ? result.count : result;
    const newFolders = (typeof result === "object") ? result.newFolders : [];
    isSorting = false;
    stopSortAnimation();
    progressFill.style.width = "100%";
    showSortedState(count, newFolders);
  } catch (err) {
    console.error("Sort failed:", err);
    isSorting = false;
    stopSortAnimation();
    progressFill.style.width = "0%";
    statusText.innerText = "Sort failed. Please try again.";
    showEmptyState("Sort failed. Please try again.");
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
  if (isSorting || isAnalyzing) return;

  // Show the undo animation immediately — before the async IPC call
  showUndoAnimation();
  statusText.innerText = "Restoring files…";
  progressFill.style.width = "0%";
  _etaStartTime = Date.now();

  // Live elapsed-time ticker (undo has no progress events)
  const _undoElapsedTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - _etaStartTime) / 1000);
    statusText.innerText = `Restoring files… (${sec}s)`;
    const subEl = document.querySelector(".undo-sub-text");
    if (subEl) subEl.textContent = `Moving files back and removing empty folders… (${sec}s elapsed)`;
  }, 1000);

  const result = appMode === "sample"
    ? await window.api.sampleUndo()
    : await window.api.undo();

  clearInterval(_undoElapsedTimer);
  stopUndoAnimation();
  const { count, sourceFolder } = result;

  if (count === 0) {
    showEmptyState("Nothing to undo.");
    return;
  }

  progressFill.style.width = "0%";
  currentFolder = sourceFolder;
  showUndoState(count, sourceFolder);
}

// ================= RESET SESSION =================
function resetSession() {
  // If analysis is in progress, show a confirmation dialog with live ETA
  if (isAnalyzing) {
    _showCancelAnalysisDialog();
    return;
  }

  _doResetSession();
}

function _doResetSession() {
  currentFolder = null;
  fullPreviewData = [];
  filteredPreviewData = [];
  isSorting = false;
  skipDuplicates = false;
  dupIncludeMap.clear();
  dupDeletedPaths.clear();
  keyFilter = { mode: "all", notes: new Set() };
  bpmRange = { min: 0, max: 300 };
  previewSearchQuery = "";
  const searchInp = document.getElementById("previewSearchInput");
  if (searchInp) searchInp.value = "";
  progressFill.style.width = "0%";
  const bar = document.getElementById("keyFilterBar");
  if (bar) bar.style.display = "none";
  const hint = document.getElementById("sortFolderHint");
  if (hint) hint.textContent = "";
  resetBpmSlider();
  showEmptyState("Select a folder to sort.");
}

// ── Cancel-analysis confirmation dialog ──────────────────────────────────────
let _cancelDialogEtaTimer = null;

function _showCancelAnalysisDialog() {
  // Don't show twice
  if (document.getElementById("cancelAnalysisOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "cancelAnalysisOverlay";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.72);
    display: flex; align-items: center; justify-content: center;
  `;

  const dialog = document.createElement("div");
  dialog.style.cssText = `
    background: #1a1a28; border: 1px solid rgba(148,0,211,0.4);
    border-radius: 12px; padding: 28px 32px; max-width: 420px; width: 90%;
    text-align: center; box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  `;

  const iconEl = document.createElement("div");
  iconEl.style.cssText = "font-size: 36px; margin-bottom: 12px;";
  iconEl.textContent = "⚠️";

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-size: 17px; font-weight: 700; color: #fff; margin-bottom: 8px;";
  titleEl.textContent = "Cancel Analysis?";

  const bodyEl = document.createElement("div");
  bodyEl.style.cssText = "font-size: 13px; color: rgba(200,160,255,0.8); line-height: 1.55; margin-bottom: 6px;";
  bodyEl.textContent = "Analysis is still running. Cancelling will stop the scan and start a new session.";

  const etaEl = document.createElement("div");
  etaEl.id = "cancelDialogEta";
  etaEl.style.cssText = `
    font-size: 13px; font-weight: 600;
    color: #c084fc; margin: 10px 0 20px;
    font-variant-numeric: tabular-nums;
  `;
  // Populate immediately with current ETA
  etaEl.textContent = _getCancelDialogEtaText();

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 12px; justify-content: center;";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Keep Analyzing";
  cancelBtn.style.cssText = `
    padding: 9px 20px; border-radius: 7px;
    background: rgba(255,255,255,0.08); color: #ccc;
    border: 1px solid rgba(255,255,255,0.15); cursor: pointer; font-size: 13px;
  `;
  cancelBtn.onclick = () => _closeCancelAnalysisDialog();

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Cancel & New Session";
  confirmBtn.style.cssText = `
    padding: 9px 20px; border-radius: 7px;
    background: #9400d3; color: #fff;
    border: none; cursor: pointer; font-size: 13px; font-weight: 600;
  `;
  confirmBtn.onclick = () => {
    _closeCancelAnalysisDialog();
    _analysisCancelled = true;
    // isAnalyzing will be cleared by runPreview when it detects the cancel flag
    // Force-stop the UI now so it feels instant
    isAnalyzing = false;
    stopAnalyzingState();
    _doResetSession();
  };

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  dialog.appendChild(iconEl);
  dialog.appendChild(titleEl);
  dialog.appendChild(bodyEl);
  dialog.appendChild(etaEl);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) _closeCancelAnalysisDialog();
  });
  // Close on Escape
  document._cancelAnalysisEscHandler = (e) => {
    if (e.key === "Escape") _closeCancelAnalysisDialog();
  };
  document.addEventListener("keydown", document._cancelAnalysisEscHandler);

  document.body.appendChild(overlay);

  // Live ETA ticker — updates every second
  _cancelDialogEtaTimer = setInterval(() => {
    const el = document.getElementById("cancelDialogEta");
    if (el) el.textContent = _getCancelDialogEtaText();
  }, 1000);
}

function _getCancelDialogEtaText() {
  if (!_etaStartTime) return "";
  const currentPct = parseFloat(progressFill?.style.width) || 0;
  const eta = calcETA(currentPct);
  if (!eta) return currentPct > 0 ? `${Math.round(currentPct)}% complete` : "Scanning…";
  return `${Math.round(currentPct)}% complete  ·  ${eta}`;
}

function _closeCancelAnalysisDialog() {
  if (_cancelDialogEtaTimer) {
    clearInterval(_cancelDialogEtaTimer);
    _cancelDialogEtaTimer = null;
  }
  const overlay = document.getElementById("cancelAnalysisOverlay");
  if (overlay) overlay.remove();
  if (document._cancelAnalysisEscHandler) {
    document.removeEventListener("keydown", document._cancelAnalysisEscHandler);
    delete document._cancelAnalysisEscHandler;
  }
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
