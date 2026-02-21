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