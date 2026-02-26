let currentFolder = null;
let fullPreviewData = [];
let filteredPreviewData = [];
let intelligenceMode = false;
let isSorting = false;

const statusText = document.getElementById("statusText");
const previewDiv = document.getElementById("preview");
const progressFill = document.getElementById("progressFill");

// ================= INTELLIGENCE TOGGLE =================
document.getElementById("intelligenceToggle")
  .addEventListener("change", e => {
    intelligenceMode = e.target.checked;
  });

// ================= INIT =================
initUI();

async function initUI() {
  const keywords = await window.api.getKeywords();
  renderCategoryToggles(keywords);
  renderKeywordEditor(keywords);
}
// ================= RESIZABLE SIDEBAR =================

document.addEventListener("DOMContentLoaded", () => {

  const divider = document.getElementById("divider");
  const sidebar = document.getElementById("sidebar");
  const main = document.querySelector(".main");

  if (!divider || !sidebar || !main) {
    console.error("Resize elements not found");
    return;
  }

  const savedWidth = localStorage.getItem("sidebarWidth");
  if (savedWidth) {
    sidebar.style.width = savedWidth;
  }

  let isDragging = false;

  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isDragging = true;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const mainRect = main.getBoundingClientRect();
    const containerWidth = mainRect.width;

    const newWidth = e.clientX - mainRect.left;

    const minWidth = 220;
    const maxWidth = containerWidth - 220; // leave minimum space for preview

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      sidebar.style.width = newWidth + "px";
    }
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;

    isDragging = false;
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";

    localStorage.setItem("sidebarWidth", sidebar.style.width);
  });

});
// ================= CATEGORY TOGGLES =================
function renderCategoryToggles(keywords) {
  const panel = document.getElementById("categoryPanel");
  panel.innerHTML = "";

  Object.entries(keywords).forEach(([cat]) => {

    if (cat === "_meta") return; // 🔥 ignore meta

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

    // ===== DEFAULT KEYWORDS =====
    data.default.forEach(word => {
      const tag = document.createElement("div");
      tag.className = "keyword-tag default active";
      tag.innerText = word;

      tag.onclick = () => {
        tag.classList.toggle("active");
      };

      tagContainer.appendChild(tag);
    });

    // ===== CUSTOM KEYWORDS =====
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

      tag.onclick = () => {
        tag.classList.toggle("active");
      };

      tag.appendChild(text);
      tag.appendChild(remove);
      tagContainer.appendChild(tag);
    });

    wrapper.appendChild(tagContainer);

    // ===== ADD CUSTOM KEYWORD INPUT =====
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
  if (!currentFolder) return;

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

  statusText.innerText =
    `${fullPreviewData.length} presets detected. Review before sorting.`;

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

  if (!enabled.length) {
    filteredPreviewData = [];
  } else {
    filteredPreviewData = fullPreviewData.filter(item =>
      enabled.includes(item.category)
    );
  }

  renderPreview();
}

// ================= PREVIEW =================
function renderPreview() {
  previewDiv.innerHTML = "";

  if (!filteredPreviewData.length) return;

  const grouped = {};

  filteredPreviewData.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  Object.entries(grouped).forEach(([category, items]) => {

    const wrapper = document.createElement("div");

    const header = document.createElement("div");
    header.className = "folder-header";
    header.style.cursor = "pointer";
    header.style.fontWeight = "600";
    header.style.marginTop = "10px";

    let open = true;
    header.textContent = `📂 ${category} (${items.length})`;

    const content = document.createElement("div");
    content.style.marginLeft = "20px";

    items.forEach(preset => {
      const row = document.createElement("div");
      row.className = "preview-row";
      row.textContent = preset.file;
      content.appendChild(row);
    });

    header.onclick = () => {
      open = !open;
      header.textContent =
        `${open ? "📂" : "📁"} ${category} (${items.length})`;
      content.style.display = open ? "block" : "none";
    };

    wrapper.appendChild(header);
    wrapper.appendChild(content);
    previewDiv.appendChild(wrapper);
  });
}


// ================= Group by Category =================
const grouped = {};

filteredPreviewData.forEach(item => {
  if (!grouped[item.category]) grouped[item.category] = [];
  grouped[item.category].push(item);
});

Object.entries(grouped).forEach(([category, items]) => {
  const wrapper = document.createElement("div");

  const header = document.createElement("div");
  header.className = "folder-header";
  header.style.cursor = "pointer";
  header.style.fontWeight = "600";
  header.style.marginTop = "10px";

  header.dataset.open = "true";
  header.dataset.labelOpen = `📂 ${category} (${items.length})`;
  header.dataset.labelClosed = `📁 ${category} (${items.length})`;

  header.textContent = header.dataset.labelOpen;

  const content = document.createElement("div");
  content.className = "folder-content";
  content.style.marginLeft = "20px";

  items.forEach(preset => {
    const row = document.createElement("div");
    row.className = "preview-row";
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";

    const nameDiv = document.createElement("div");
    nameDiv.textContent = preset.file;

    const badgeContainer = document.createElement("div");
    badgeContainer.style.display = "flex";
    badgeContainer.style.gap = "6px";

    if (intelligenceMode && preset.intelligence) {
      const intel = preset.intelligence;

      if (intel.key) {
        const keyBadge = document.createElement("span");
        keyBadge.className = "category-tag";
        keyBadge.style.background = "#00aaff";
        keyBadge.textContent = intel.key.toUpperCase();
        badgeContainer.appendChild(keyBadge);
      }

      if (intel.bpm) {
        const bpmBadge = document.createElement("span");
        bpmBadge.className = "category-tag";
        bpmBadge.style.background = "#ffaa00";
        bpmBadge.textContent = `${intel.bpm} BPM`;
        badgeContainer.appendChild(bpmBadge);
      }

      if (intel.mood) {
        const moodBadge = document.createElement("span");
        moodBadge.className = "category-tag";
        moodBadge.style.background = "#9b59b6";
        moodBadge.textContent = intel.mood;
        badgeContainer.appendChild(moodBadge);
      }
    }

    row.appendChild(nameDiv);
    row.appendChild(badgeContainer);
    content.appendChild(row);
  });

  header.onclick = () => {
    const open = header.dataset.open === "true";
    header.dataset.open = (!open).toString();
    header.textContent = open
      ? header.dataset.labelClosed
      : header.dataset.labelOpen;
    content.style.display = open ? "none" : "block";
  };

  wrapper.appendChild(header);
  wrapper.appendChild(content);
  previewDiv.appendChild(wrapper);
});
// ================= START SORT =================
async function startSort() {
  if (!filteredPreviewData.length || isSorting) return;

  isSorting = true;
  statusText.innerText = "Sorting...";
  progressFill.style.width = "0%";

  window.api.onProgress(val => {
    progressFill.style.width = val + "%";
  });

  const count = await window.api.execute(
    currentFolder,
    filteredPreviewData,
    intelligenceMode
  );

  statusText.innerText = `Sorted ${count} presets.`;
  isSorting = false;
}

// ================= UNDO =================
async function undo() {
  if (isSorting) return;

  const count = await window.api.undo();
  statusText.innerText = `Undo restored ${count} presets.`;
  progressFill.style.width = "0%";
}