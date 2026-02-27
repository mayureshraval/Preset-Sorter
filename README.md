<div align="center">

# 🎛️ Preset Sorter Pro

**An intelligent desktop app for automatically organizing your VST/AU synth presets into clean, categorized folders.**

[![Electron](https://img.shields.io/badge/Built%20with-Electron-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square&logo=windows)](https://github.com)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-9400D3?style=flat-square&logo=gnu)](https://www.gnu.org/licenses/gpl-3.0)
[![Version](https://img.shields.io/badge/Version-1.0.0-green?style=flat-square)](https://github.com)

</div>

---

## 📖 Overview

Preset Sorter Pro is a native Windows desktop application built with Electron that scans folders of `.fxp` and `.fxb` preset files and automatically organizes them into intelligent category-based subfolders. Whether you have hundreds of synth patches scattered across your drive or a chaotic preset library, Preset Sorter Pro analyzes each filename and sorts it into the right place — in seconds.

---

## ✨ Features

### 🤖 Intelligent Categorization
- Keyword-based scoring engine that analyzes filenames and maps them to categories like Synths, Bass, Pads, Leads, Percussion, and more
- Prefix-code detection (e.g. `WW`, `KY`, `SYN`) for label-aware sorting
- Word-boundary matching with weighted scoring — longer, more specific keywords carry higher confidence
- Falls back to a **Misc** category for unrecognized presets, so nothing gets lost

### 🧠 Intelligence Mode
- Optional metadata extraction layer that reads BPM, musical key, and mood directly from filenames
- BPM detection supports formats like `120bpm`, `bpm120`, `(120)`, `-120-`
- Key detection covers sharps, flats, major/minor modes (e.g. `Am`, `C#`, `F minor`)
- Mood tagging from keywords like `dark`, `ambient`, `bright`, `lush`, `trap`

### 👁️ Live Sort Preview
- See exactly where every preset will be sorted before touching a single file
- Three view modes: **List**, **Grid**, and **Columns**
- Expand/collapse individual folders or all at once
- Filter by category using toggles in the sidebar

### 🔁 One-Click Undo
- Every sort operation is logged to a `move-log.json` file
- Full undo restores all files to their original locations and removes empty folders
- Undo works even after starting a new session — the original paths are always persisted

### ⚙️ Customizable Keywords
- Edit keyword lists per category directly inside the app
- Each category has default keywords (locked) and custom keywords (user-editable)
- Restore all categories to default keywords with a single button
- Changes are saved to `keywords.json` and applied immediately on next preview

### 🖥️ Polished UI
- Dark-themed interface with resizable sidebar (drag to adjust horizontally or vertically on narrow screens)
- Responsive layout adapts to window size
- Real-time progress bar during sort operations
- Clickable drop-zone empty state for quick folder selection
- Drag-and-drop folder support

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or higher
- **npm** v8 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/preset-sorter-pro.git
cd preset-sorter-pro

# Install dependencies
npm install

# Launch the app in development mode
npm start
```

### Building for Production

```bash
npm run build
```

The installer will be generated in the `release/` directory as a Windows `.exe` NSIS installer.

---

## 🗂️ How It Works

```
1. Select a folder containing .fxp / .fxb preset files
2. Preset Sorter Pro scans all files (including subfolders)
3. Each filename is scored against keyword lists for every category
4. A live preview shows the proposed sort — review before committing
5. Click "Sort" to move files into categorized subfolders
6. Use "Undo" at any time to revert the entire operation
```

### Scoring Algorithm

Each filename is normalized (underscores, dashes, and dots replaced with spaces) and then scored against all category keywords:

| Match Type | Score |
|---|---|
| Prefix code match (e.g. `WW`, `SYN`) | +50 |
| Long keyword (6+ chars), word boundary | +6 + keyword length |
| Short keyword (3–4 chars), word boundary | +4 |
| Very short keyword (≤2 chars) | +1 |
| Partial match for long keywords (>5 chars) | +2 |

The category with the highest total score wins. Ties or zero-score files go to **Misc**.

---

## 📁 Project Structure

```
preset-sorter-pro/
├── main.js           # Electron main process — window, IPC handlers, menu
├── preload.js        # Context bridge — securely exposes API to renderer
├── renderer.js       # UI logic — preview, sorting, undo, keyword editor
├── sorter.js         # Core engine — scanning, scoring, file moving, undo
├── intelligence.js   # Metadata extractor — BPM, key, mood from filenames
├── index.html        # Main application window
├── about.html        # About dialog
├── keywords.json     # Default + custom keywords per category
├── config.json       # App config (version, duplicate mode, intelligence flag)
├── package.json      # Electron & build config
└── assets/
    └── icon.ico      # App icon
```

---

## ⌨️ Keyboard Shortcuts & UI Interactions

| Action | How |
|---|---|
| Select folder | Click the **Select Folder** button or click anywhere in the preview drop zone |
| Preview sort | Happens automatically after folder selection |
| Toggle categories | Use the sidebar toggles to include/exclude categories from the sort |
| Toggle Intelligence Mode | Use the toggle in the sidebar header |
| Sort files | Click the **Sort** button in the toolbar |
| Undo last sort | Click the **Undo** button — works across sessions |
| Open sorted folder | Click **Open Sorted Folder** after a successful sort |
| New session | Click **Start New Session** to reset the UI |
| Edit keywords | Use the keyword editor panel in the sidebar |
| Restore defaults | Click **Restore Defaults** in the keyword editor |

---

## 🔧 Configuration

`config.json` stores app-level settings:

```json
{
  "version": "1.0.0",
  "appName": "Preset Sorter Pro",
  "duplicateMode": "detect",
  "intelligenceMode": false
}
```

`keywords.json` maps each category to its keyword lists:

```json
{
  "Bass": {
    "default": ["bass", "sub", "808", "low"],
    "custom": []
  },
  ...
}
```

Custom keywords added through the UI are saved to the `custom` array per category. Default keywords are never modified by the UI — only the **Restore Defaults** action touches them (by clearing custom arrays).

---

## 🛡️ Safety & Reliability

- **Non-destructive preview** — files are never moved until you explicitly click Sort
- **Duplicate resolution** — if a destination file already exists, a `(1)`, `(2)`, etc. suffix is appended automatically
- **Persistent undo log** — `move-log.json` is written to the system's `userData` directory, surviving app restarts
- **Category folder skip** — the scanner skips subfolders that match known category names to avoid re-scanning already-sorted files
- **Error recovery** — sort failures are caught and displayed without leaving the UI in a broken state

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome. Please open an issue or submit a pull request.

For questions or support, contact: [presetsorterpro@outlook.com](mailto:presetsorterpro@outlook.com)

---

## ❤️ Support the Project

If Preset Sorter Pro has saved you time, consider buying the developer a coffee:

[**Donate via PayPal →**](https://www.paypal.com/ncp/payment/3ZDDHX6KCHTCE)

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

This means you are free to:
- ✅ **Use** this software for any purpose
- ✅ **Study** and modify the source code
- ✅ **Distribute** copies of the original software
- ✅ **Distribute** your modified versions

Under the condition that any distributed version — modified or not — is also released under the GPL-3.0 license with its source code made available.

See the [LICENSE](LICENSE) file for the full license text, or read it at [gnu.org/licenses/gpl-3.0](https://www.gnu.org/licenses/gpl-3.0).

© 2024 Mayuresh Rawal
