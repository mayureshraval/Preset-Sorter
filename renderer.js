let currentFolder = null;
let previewData = [];
let duplicateData = [];
let progressListenerAttached = false;

const statusText = document.getElementById("statusText");
const previewDiv = document.getElementById("preview");
const summaryBox = document.getElementById("summaryBox");
const previewSection = document.getElementById("previewSection");
const progressFill = document.getElementById("progressFill");
const selectBtn = document.getElementById("selectBtn");

function setBusy(state) {
  selectBtn.disabled = state;
}

function getEnabledCategories() {
  const checkboxes = document.querySelectorAll(".category-toggle:checked");

  if (checkboxes.length === 0) {
    return null; // means allow all categories
  }

  return Array.from(checkboxes).map(cb => cb.value);
}

async function selectFolder() {
  currentFolder = await window.api.chooseFolder();
  if (!currentFolder) return;

  setBusy(true);
  statusText.innerText = "Analyzing presets...";
  progressFill.style.width = "0%";

  const enabledCategories = getEnabledCategories();

  const response = await window.api.preview(currentFolder, enabledCategories);

  previewData = response.results;
  duplicateData = response.duplicates;

  setBusy(false);

  if (!previewData.length) {
    statusText.innerText = "No presets found.";
    return;
  }

  previewSection.style.display = "block";
  summaryBox.style.display = "block";

  renderPreview();
  renderSummary();

  if (duplicateData.length > 0) {
    statusText.innerText = `Preview ready. ${duplicateData.length} duplicate(s) detected.`;
  } else {
    statusText.innerText = "Preview ready. No duplicates detected.";
  }
}

function renderPreview() {
  previewDiv.innerHTML = "";

  previewData.slice(0, 400).forEach(item => {
    const row = document.createElement("div");
    row.className = "preview-row";

    const file = document.createElement("div");
    file.textContent = item.file;

    const tag = document.createElement("div");
    tag.className = "category-tag";
    tag.textContent = item.category;

    row.appendChild(file);
    row.appendChild(tag);
    previewDiv.appendChild(row);
  });

  if (previewData.length > 400) {
    const more = document.createElement("div");
    more.style.opacity = "0.6";
    more.style.padding = "6px 10px";
    more.textContent = `...and ${previewData.length - 400} more`;
    previewDiv.appendChild(more);
  }
}

function renderSummary() {
  const counts = {};

  previewData.forEach(item => {
    counts[item.category] = (counts[item.category] || 0) + 1;
  });

  let duplicateSection = "";
  if (duplicateData.length > 0) {
    duplicateSection = `
      <br><br>
      <strong style="color:#ff5555;">Duplicates Detected:</strong><br>
      ${duplicateData.slice(0, 10).join("<br>")}
      ${duplicateData.length > 10 ? `<br>...and ${duplicateData.length - 10} more` : ""}
    `;
  }

  summaryBox.innerHTML = `
    <strong>Total Presets:</strong> ${previewData.length}<br><br>
    ${Object.entries(counts)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join("<br>")}
    ${duplicateSection}
    <br><br>
    <button onclick="confirmSort()">Confirm Sort</button>
    <button onclick="cancelSort()">Cancel</button>
  `;
}

function cancelSort() {
  previewSection.style.display = "none";
  summaryBox.style.display = "none";
  previewDiv.innerHTML = "";
  statusText.innerText = "Sort cancelled.";
  progressFill.style.width = "0%";
}

async function confirmSort() {
  if (!previewData.length) return;

  setBusy(true);
  statusText.innerText = "Sorting...";
  progressFill.style.width = "0%";

  if (!progressListenerAttached) {
    window.api.onProgress(value => {
      progressFill.style.width = value + "%";
    });
    progressListenerAttached = true;
  }

  const count = await window.api.execute(currentFolder, previewData);

  statusText.innerText = `Completed. ${count} presets sorted successfully.`;
  previewSection.style.display = "none";
  summaryBox.style.display = "none";
  setBusy(false);
}

async function undo() {
  const count = await window.api.undo();

  if (count === 0) {
    statusText.innerText = "Nothing to undo.";
  } else {
    statusText.innerText = `Undo complete. ${count} presets restored.`;
  }

  progressFill.style.width = "0%";
}