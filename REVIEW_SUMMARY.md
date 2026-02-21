# Preset Sorter Pro - Code Review Summary

This repository is an Electron desktop app for organizing `.fxp`/`.fxb` synth preset files.

## What it does
- Lets users choose a folder containing preset packs.
- Scans pack subfolders and categorizes presets by keyword rules.
- Shows a preview grouped by pack/category before moving files.
- Optionally appends detected musical metadata (key/BPM/mood) to filenames during move.
- Supports undo by writing a move log and replaying moves in reverse.

## Architecture
- `main.js`: Electron main process and IPC handlers.
- `preload.js`: secure bridge exposing allowed IPC APIs to renderer.
- `renderer.js`: UI interactions (folder select, preview, filtering, keyword editor, sort/undo).
- `sorter.js`: filesystem scanning, categorization, move execution, and undo.
- `intelligence.js`: metadata detection via regex from file names.
- `keywords.json`: editable default/custom keyword catalog.
- `index.html`: single-page UI and styles.

## Notable findings
- `sorter.js` expects category objects with `{ default, custom }`, but its `getDefaultKeywords()` returns arrays. This mismatch can break keyword handling when regenerating defaults.
- `sorter.js` defines `getDefaultKeywords()` and `restore-defaults` in main process uses it, but `sorter.js` does not export it; this will throw when restore is invoked.
- `renderer.js` contains a block of preview-grouping UI code at top-level (outside `renderPreview`) that appears to be leftover/duplicated logic.
- `intelligenceMode` is passed into `previewSort()` but not used inside sorting preview logic.

