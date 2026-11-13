// Chapters put a mode's levels in play order. A level is known by its id, a slug that never
// changes; the label a player sees ("1-3") comes from its chapter and its place in that chapter,
// so moving a level changes its label and nothing that was saved under its id.
export interface Chapter {
  id: string;
  title: string;
  /// One short line under the title on the level list.
  blurb: string;
  /// Level ids in play order.
  levels: string[];
}

/// Every level id of a mode, first to last.
export const playOrder = (chapters: Chapter[]): string[] => chapters.flatMap((c) => c.levels);

/// The label for a level: its chapter's id, a dash, and its place in the chapter counted from 1.
/// An id no chapter lists has no label.
export const labelOf = (chapters: Chapter[], id: string): string => {
  for (const chapter of chapters) {
    const at = chapter.levels.indexOf(id);
    if (at >= 0) return `${chapter.id}-${at + 1}`;
  }
  return "";
};
