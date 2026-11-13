// Dates for the level that is made new each day. A day is the player's own calendar day, written
// "2026-11-13", so the tower changes at their midnight and a streak counts their days.

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/// The local calendar date of a moment, as "2026-11-13".
export const localDate = (now: Date): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/// The year, month and day of a date string as numbers, or null when it is not a real date.
const parts = (date: string): [number, number, number] | null => {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!found) return null;
  const y = Number(found[1]), m = Number(found[2]), d = Number(found[3]);
  // A day that does not exist, such as 30 February, rolls over into the next month and is refused.
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? [y, m, d] : null;
};

/// The date `days` after a date, or before it for a negative number. Month ends, year ends and
/// leap days are the calendar's, and no clock or time zone comes into it.
export const addDays = (date: string, days: number): string => {
  const at = parts(date);
  if (!at) return date;
  const moved = new Date(Date.UTC(at[0], at[1] - 1, at[2] + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
};

/// A date in words, day first: "13 November".
export const dateWords = (date: string): string => {
  const at = parts(date);
  return at ? `${at[2]} ${MONTHS[at[1] - 1]}` : date;
};

/// A streak in plain words.
export const streakWords = (days: number): string =>
  days <= 0 ? "No streak yet" : days === 1 ? "1 day running" : `${days} days running`;
