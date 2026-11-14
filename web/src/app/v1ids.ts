// Version 1 of the save kept each result under the level's two-digit file number. Levels are
// now known by a slug that does not change when they move, and this is the one place the old
// numbers still mean something: an old save is carried over through it.
// Pull the Pin has no table. The twelve levels its numbers stood for were replaced by a new
// campaign, so an old save's Pull the Pin results have nowhere to go and are dropped. Its other
// modes carry over as before.
// Save the Clawd keeps fifteen of its sixteen. Number 10, No ink overhead, is not in the
// campaign any more, so a result saved under it is dropped.
export const V1_IDS: Record<string, Record<string, string>> = {
  saveDog: {
    "01": "first-shield", "02": "lid", "03": "pedestal", "04": "the-plug",
    "05": "side-door", "06": "roll-it-in", "07": "two-cliffs", "08": "across-the-water",
    "09": "between-the-blades", "11": "holes-below", "12": "slope",
    "13": "moat", "14": "two-caves", "15": "low-ceiling", "16": "saws",
  },
};
