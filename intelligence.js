function detectPresetMetadata(filename) {
  const name = filename.toLowerCase();

  const result = {
    bpm: null,
    key: null,
    mood: null
  };

  const bpmMatch = name.match(/(\d{2,3})bpm/);
  if (bpmMatch) result.bpm = bpmMatch[1];

  const keyMatch = name.match(/\b([a-g](#|b)?m?)\b/);
  if (keyMatch) result.key = keyMatch[1];

  if (name.includes("dark")) result.mood = "Dark";
  if (name.includes("ambient")) result.mood = "Ambient";

  return result;
}

module.exports = { detectPresetMetadata };