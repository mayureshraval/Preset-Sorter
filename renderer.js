let currentFolder = null;
let previewData = [];
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

async function selectFolder() {
  currentFolder = await window.api.chooseFolder();
  if (!currentFolder) return;

  setBusy(true);
  statusText.innerText = "Analyzing presets...";
  progressFill.style.width = "0%";

  previewData = await window.api.preview(currentFolder);

  setBusy(false);

  if (!previewData.length) {
    statusText.innerText = "No presets found.";
    return;
  }

  statusText.innerText = "Preview ready.";
  previewSection.style.display = "block";
  summaryBox.style.display = "block";

  renderPreview();
  renderSummary();
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
}

function renderSummary() {
  const counts = {};

  previewData.forEach(item => {
    counts[item.category] = (counts[item.category] || 0) + 1;
  });

  summaryBox.innerHTML = `
    Total Presets: ${previewData.length}<br><br>
    ${Object.entries(counts)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join("<br>")}
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

  statusText.innerText = `Completed. ${count} presets sorted.`;
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