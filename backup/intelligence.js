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
// intelligence.js

function detectPresetMetadata(filename) {
  const name = filename.toLowerCase();

  const result = {
    bpm: null,
    key: null,
    mood: null
  };

  // ================= BPM Detection =================
  // Matches:
  // 120bpm
  // 120 bpm
  // bpm120
  // (120)
  // -120-
  const bpmMatch = name.match(
    /(?:^|\D)(\d{2,3})\s?bpm|bpm\s?(\d{2,3})|(?:\(|\-)(\d{2,3})(?:\)|\-)/i
  );

  if (bpmMatch) {
    result.bpm = (bpmMatch[1] || bpmMatch[2] || bpmMatch[3])?.toString();
  }

  // ================= KEY Detection =================
  // Matches:
  // Am, A#m, C#, Fmin, G major, D minor
  const keyMatch = name.match(
    /\b([a-g])\s?(#|b)?\s?(m(in)?|major|minor)?\b/i
  );

  if (keyMatch) {
    const base = keyMatch[1].toUpperCase() + (keyMatch[2] || "");
    const mode = (keyMatch[3] || "").toLowerCase();

    if (mode.includes("min") || mode === "m") {
      result.key = base + "m";
      result.mood = "Minor";
    } else if (mode.includes("major")) {
      result.key = base;
      result.mood = "Major";
    } else {
      result.key = base;
    }
  }

  // ================= Mood Keywords =================
  if (!result.mood) {
    if (/\b(dark|grim|gloom|heavy|trap)\b/.test(name))
      result.mood = "Dark";

    if (/\b(ambient|pad|soft|warm|lush|dream)\b/.test(name))
      result.mood = "Ambient";

    if (/\b(happy|bright|uplift|plucky|pop)\b/.test(name))
      result.mood = "Bright";
  }

  return result;
}

module.exports = { detectPresetMetadata };