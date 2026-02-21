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

  const tools = document.createElement("div");
  tools.style.display = "flex";
  tools.style.justifyContent = "flex-end";
  tools.style.marginBottom = "10px";

  const restoreBtn = document.createElement("button");
  restoreBtn.textContent = "Restore Defaults";
  restoreBtn.onclick = async () => {
    const confirmed = window.confirm(
      "Restore all categories/keywords to defaults? This will remove custom keyword changes."
    );
    if (!confirmed) return;

    const defaults = await window.api.restoreDefaults();
    renderCategoryToggles(defaults);
    renderKeywordEditor(defaults);
    statusText.innerText = "Keyword defaults restored.";
  };

  tools.appendChild(restoreBtn);
  container.appendChild(tools);

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

  const response = await window.api.preview(
    currentFolder,
    null,
    intelligenceMode
  );

  console.log("Preview response:", response);

  fullPreviewData = response.results || [];
  applyFilter();

  statusText.innerText = `Ready. ${fullPreviewData.length} presets found.`;
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

  const grouped = {};

  filteredPreviewData.forEach(item => {
    if (!grouped[item.packRoot]) {
      grouped[item.packRoot] = {};
    }

    if (!grouped[item.packRoot][item.category]) {
      grouped[item.packRoot][item.category] = [];
    }

    grouped[item.packRoot][item.category].push(item);
  });

  Object.entries(grouped).forEach(([parent, categories]) => {

    const parentWrapper = document.createElement("div");
    let parentOpen = true;

    const parentHeader = document.createElement("div");
    parentHeader.style.cursor = "pointer";
    parentHeader.style.fontWeight = "600";
    parentHeader.innerText = `📂 ${parent}`;

    const parentContent = document.createElement("div");
    parentContent.style.marginLeft = "15px";

    parentHeader.onclick = () => {
      parentOpen = !parentOpen;
      parentContent.style.display = parentOpen ? "block" : "none";
      parentHeader.innerText = `${parentOpen ? "📂" : "📁"} ${parent}`;
    };

    Object.entries(categories).forEach(([category, items]) => {

      let catOpen = true;

      const catHeader = document.createElement("div");
      catHeader.style.cursor = "pointer";
      catHeader.style.fontWeight = "500";
      catHeader.style.marginTop = "6px";
      catHeader.innerText = `📂 ${category} (${items.length})`;

      const catContent = document.createElement("div");
      catContent.style.marginLeft = "15px";

      catHeader.onclick = () => {
        catOpen = !catOpen;
        catContent.style.display = catOpen ? "block" : "none";
        catHeader.innerText =
          `${catOpen ? "📂" : "📁"} ${category} (${items.length})`;
      };

      items.forEach(preset => {
        const row = document.createElement("div");
        row.className = "preview-row";
        row.textContent = preset.file;
        catContent.appendChild(row);
      });

      parentContent.appendChild(catHeader);
      parentContent.appendChild(catContent);
    });

    parentWrapper.appendChild(parentHeader);
    parentWrapper.appendChild(parentContent);
    previewDiv.appendChild(parentWrapper);
  });
}
// ================= Controls =================
const controls = document.createElement("div");
controls.style.marginBottom = "12px";

const expandBtn = document.createElement("button");
expandBtn.textContent = "Expand All";
expandBtn.style.marginRight = "8px";
expandBtn.onclick = () => {
  document.querySelectorAll(".folder-content")
    .forEach(el => el.style.display = "block");

  document.querySelectorAll(".folder-header")
    .forEach(el => {
      el.dataset.open = "true";
      el.textContent = el.dataset.labelOpen;
    });
};

const collapseBtn = document.createElement("button");
collapseBtn.textContent = "Collapse All";
collapseBtn.onclick = () => {
  document.querySelectorAll(".folder-content")
    .forEach(el => el.style.display = "none");

  document.querySelectorAll(".folder-header")
    .forEach(el => {
      el.dataset.open = "false";
      el.textContent = el.dataset.labelClosed;
    });
};

controls.appendChild(expandBtn);
controls.appendChild(collapseBtn);
previewDiv.appendChild(controls);

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
