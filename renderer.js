let currentFolder = null;
let fullPreviewData = [];
let filteredPreviewData = [];
let intelligenceMode = false;
let isSorting = false;

const statusText = document.getElementById("statusText");
const previewDiv = document.getElementById("preview");
const progressFill = document.getElementById("progressFill");




// 
function showEmptyState(message = "Select a folder to sort.") {
  previewDiv.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.height = "100%";
  wrapper.style.textAlign = "center";
  wrapper.style.opacity = "0.85";

  const icon = document.createElement("div");
  icon.textContent = "📂";
  icon.style.fontSize = "40px";
  icon.style.marginBottom = "12px";

  const title = document.createElement("div");
  title.style.fontWeight = "700";
  title.style.fontSize = "18px";
  title.textContent = message;

  const subtitle = document.createElement("div");
  subtitle.style.fontSize = "13px";
  subtitle.style.opacity = "0.6";
  subtitle.style.marginTop = "6px";
  subtitle.textContent = "Choose a preset folder to begin analysis.";

  wrapper.appendChild(icon);
  wrapper.appendChild(title);
  wrapper.appendChild(subtitle);

  previewDiv.appendChild(wrapper);

  statusText.innerText = message;
}
// 

// sorted
function showSortedState(sortedCount) {
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

  button.onclick = () => {
    window.api.openFolder(currentFolder);
  };

  const newSessionBtn = document.createElement("button");
  newSessionBtn.textContent = "Start New Session";
  newSessionBtn.style.marginTop = "10px";

  newSessionBtn.onclick = () => {
    resetSession();
  };

  wrapper.appendChild(icon);
  wrapper.appendChild(title);
  wrapper.appendChild(subtitle);
  wrapper.appendChild(button);
  wrapper.appendChild(newSessionBtn);

  previewDiv.appendChild(wrapper);

  statusText.innerText = `Sorted ${sortedCount} presets.`;
}
// sorted

// ================= INTELLIGENCE TOGGLE =================
document.getElementById("intelligenceToggle")
  .addEventListener("change", e => {
    intelligenceMode = e.target.checked;
    renderPreview(); // 🔥 re-render immediately
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

  // ===== Controls =====
  const controls = document.createElement("div");
  controls.style.marginBottom = "12px";

  const expandBtn = document.createElement("button");
  expandBtn.textContent = "Expand All";
  expandBtn.style.marginRight = "8px";

  const collapseBtn = document.createElement("button");
  collapseBtn.textContent = "Collapse All";

  controls.appendChild(expandBtn);
  controls.appendChild(collapseBtn);
  previewDiv.appendChild(controls);

  const grouped = {};

  filteredPreviewData.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  const folderElements = [];

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
      row.textContent = preset.file;
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

    folderElements.push({ header, content });
  });

  // Expand All
  expandBtn.onclick = () => {
    folderElements.forEach(({ header, content }) => {
      header.dataset.open = "true";
      header.textContent = header.dataset.labelOpen;
      content.style.display = "block";
    });
  };

  // Collapse All
  collapseBtn.onclick = () => {
    folderElements.forEach(({ header, content }) => {
      header.dataset.open = "false";
      header.textContent = header.dataset.labelClosed;
      content.style.display = "none";
    });
  };
}



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
  filteredPreviewData
);

isSorting = false;
progressFill.style.width = "100%";

showSortedState(count);
}



// ================= UNDO =================
async function undo() {
  if (isSorting) return;

  const count = await window.api.undo();

  currentFolder = null;
  fullPreviewData = [];
  filteredPreviewData = [];

  progressFill.style.width = "0%";

  showEmptyState(`Undo restored ${count} presets. Select a folder to sort.`);
}

// reset session 
function resetSession() {
  currentFolder = null;
  fullPreviewData = [];
  filteredPreviewData = [];
  isSorting = false;

  previewDiv.innerHTML = "";
  progressFill.style.width = "0%";
  statusText.innerText = "Ready.";
}