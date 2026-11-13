// Version 1 of the save kept each result under the level's two-digit file number. Levels are
// now known by a slug that does not change when they move, and this is the one place the old
// numbers still mean something: an old save is carried over through it.
export const V1_IDS: Record<string, Record<string, string>> = {
  pinPull: {
    "01": "two-ways-down", "02": "wash-him-out", "03": "clear-the-landing", "04": "the-slide",
    "05": "down-the-chute", "06": "mind-the-hole", "07": "down-the-well", "08": "the-side-door",
    "09": "two-taps", "10": "gem-in-the-flood", "11": "ride-the-pin", "12": "the-whole-tower",
  },
  saveDog: {
    "01": "first-shield", "02": "lid", "03": "pedestal", "04": "the-plug",
    "05": "side-door", "06": "roll-it-in", "07": "two-cliffs", "08": "across-the-water",
    "09": "between-the-blades", "10": "no-ink-overhead", "11": "holes-below", "12": "slope",
    "13": "moat", "14": "two-caves", "15": "low-ceiling", "16": "saws",
  },
};
