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
function showSortedState(sortedCount) {
  clearPreviewInteractivity();
  previewDiv.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.height = "100%";
  wrapper.style.textAlign = "center";
  wrapper.style.opacity = "0.9";

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

  const button = document.createElement("button");
  button.textContent = "Open Sorted Folder";
  button.style.marginTop = "16px";
  button.onclick = () => window.api.openFolder(currentFolder);

  const newSessionBtn = document.createElement("button");
  newSessionBtn.textContent = "Start New Session";
  newSessionBtn.style.marginTop = "10px";
  newSessionBtn.onclick = () => resetSession();

  wrapper.appendChild(icon);
  wrapper.appendChild(title);
  wrapper.appendChild(subtitle);
  wrapper.appendChild(button);
  wrapper.appendChild(newSessionBtn);
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
  const keywords = await window.api.getKeywords();
  renderCategoryToggles(keywords);
  renderKeywordEditor(keywords);
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
    statusText.innerText = "Analyzing presets...";
    progressFill.style.width = "0%";
    previewBox.innerHTML = "";

    try {
      fullPreviewData = await window.api.preview(currentFolder);
    } catch (err) {
      console.error(err);
      statusText.innerText = "Error analyzing folder.";
      return;
    }

    if (!fullPreviewData.length) {
      statusText.innerText = "No presets found in dropped folder.";
      return;
    }

    filteredPreviewData = [...fullPreviewData];
    statusText.innerText = `${fullPreviewData.length} presets detected. Review before sorting.`;
    renderPreview();
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

  if (!currentFolder) {
    showEmptyState();
    return;
  }

  statusText.innerText = "Analyzing presets...";
  progressFill.style.width = "0%";
  previewDiv.innerHTML = "";

  try {
    fullPreviewData = await window.api.preview(currentFolder);
  } catch (err) {
    console.error(err);
    statusText.innerText = "Error analyzing folder.";
    return;
  }

  if (!fullPreviewData.length) {
    statusText.innerText = "No presets found.";
    return;
  }

  filteredPreviewData = [...fullPreviewData];
  statusText.innerText = `${fullPreviewData.length} presets detected. Review before sorting.`;
  renderPreview();
}

function getEnabledCategories() {
  return Array.from(
    document.querySelectorAll(".category-toggle:checked")
  ).map(cb => cb.value);
}

// ================= FILTER =================
function applyFilter() {
  const enabled = getEnabledCategories();

  filteredPreviewData = !enabled.length
    ? []
    : fullPreviewData.filter(item => enabled.includes(item.category));

  renderPreview();
}

// ================= UNDO STATE =================
function showUndoState(restoredCount) {
  clearPreviewInteractivity();
  previewDiv.innerHTML = "";

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
  title.textContent = `Undo restored ${restoredCount} presets`;

  const subtitle = document.createElement("div");
  subtitle.style.fontSize = "13px";
  subtitle.style.opacity = "0.6";
  subtitle.style.marginTop = "6px";
  subtitle.textContent = "Your original folder structure has been restored.";

  const openBtn = document.createElement("button");
  openBtn.textContent = "Open Restored Folder";
  openBtn.style.marginTop = "16px";
  openBtn.onclick = () => window.api.openFolder(currentFolder);

  const newSessionBtn = document.createElement("button");
  newSessionBtn.textContent = "Start New Session";
  newSessionBtn.style.marginTop = "10px";
  newSessionBtn.onclick = () => resetSession();

  wrapper.appendChild(icon);
  wrapper.appendChild(title);
  wrapper.appendChild(subtitle);
  wrapper.appendChild(openBtn);
  wrapper.appendChild(newSessionBtn);
  previewDiv.appendChild(wrapper);

  statusText.innerText = `Undo restored ${restoredCount} presets.`;
}

// ================= PREVIEW =================
// Persisted view mode across re-renders
let currentView = "list"; // "list" | "grid" | "columns"

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

  // Left: Expand / Collapse (hidden in columns view)
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
      name.textContent = category;

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
        row.textContent = preset.file;
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
      name.textContent = category;

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
        // Show name without extension for compactness
        chip.textContent = preset.file.replace(/\.(fxp|fxb)$/i, "");
        chip.title = preset.file;
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
      name.textContent = category;

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
        row.textContent = preset.file.replace(/\.(fxp|fxb)$/i, "");
        row.title = preset.file;
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
}

// ================= START SORT =================
async function startSort() {
  if (!filteredPreviewData.length || isSorting) return;

  isSorting = true;
  statusText.innerText = "Sorting...";
  progressFill.style.width = "0%";

  window.api.onProgress(val => {
    progressFill.style.width = val + "%";
  });

  // 🔥 FIX: wrap in try/catch so any error (e.g. asar write failure, IPC
  // rejection) resets isSorting and shows the user an error instead of
  // leaving the UI permanently stuck on "Sorting..."
  try {
    const count = await window.api.execute(currentFolder, filteredPreviewData);
    isSorting = false;
    progressFill.style.width = "100%";
    showSortedState(count);
  } catch (err) {
    console.error("Sort failed:", err);
    isSorting = false;
    progressFill.style.width = "0%";
    statusText.innerText = "Sort failed. Please try again.";
  }
}

// ================= UNDO =================
async function undo() {
  if (isSorting) return;

  const result = await window.api.undo();

  // sorter returns { count, sourceFolder } — we never rely on currentFolder
  // being set, so this works correctly even after New Session (currentFolder = null)
  const { count, sourceFolder } = result;

  if (count === 0) {
    showEmptyState("Nothing to undo.");
    return;
  }

  fullPreviewData = [];
  filteredPreviewData = [];
  progressFill.style.width = "0%";

  // Always restore from the log's own path record, not the in-memory variable
  currentFolder = sourceFolder;

  showUndoState(count);
}

// ================= RESET SESSION =================
function resetSession() {
  currentFolder = null;
  fullPreviewData = [];
  filteredPreviewData = [];
  isSorting = false;
  progressFill.style.width = "0%";
  showEmptyState("Select a folder to sort.");
}
