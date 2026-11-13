// A level's measured difficulty, in words. The ads say "only 1% can solve this"; these lines say
// what was measured and nothing more: the share of random play that wins, by the mode's own model
// of random play (scripts/stats.ts). They never speak of people, because no people were measured.

/// What the app keeps of a level's statistics.
export interface LevelStat {
  /// The share of random play that wins, 0 to 1.
  randomWin: number;
  /// How many plays or sequences the share was counted from.
  sample: number;
  /// True when every possible play was counted, false for a sample.
  exact: boolean;
}

/// How a mode names its random play: "pulls" that "win", "doodles" that "survive".
export interface OddsWords { tries: string; win: string }

export interface OddsText {
  /// The sticker in a level: a line that shouts and a line that explains.
  big: string;
  small: string;
  /// "warm" for a level random play wins half the time or more; "hard" for the rest.
  tone: "hard" | "warm";
  /// The corner tag on a level tile, for a level whose share shows as 10% or less.
  tag: string | null;
  /// The line under the stamp on the result card after a loss, and after a win.
  lost: string | null;
  won: string | null;
}

export const oddsText = (stat: LevelStat, words: OddsWords): OddsText => {
  const { tries, win } = words;
  const percent = Math.round(stat.randomWin * 100);
  // No random try won, or so few that the share rounds to nothing. All the sample can say is
  // that the share is under the smallest one it could have shown: one win in the whole sample.
  if (percent < 1) {
    const floor = stat.randomWin > 0 ? 1 : Math.max(1, Math.round(100 / Math.max(1, stat.sample)));
    return {
      big: `UNDER ${floor}%`, small: `of random ${tries} ${win}`, tone: "hard", tag: `<${floor}%`,
      lost: `Over ${100 - floor}% of random ${tries} fail here too.`,
      won: `Random ${tries} ${win} this less than ${floor}% of the time. You are not random.`,
    };
  }
  if (percent < 50) {
    return {
      big: `ONLY ${percent}%`, small: `of random ${tries} ${win}`, tone: "hard",
      // The tile and the sticker show the same rounded figure, so they agree about which levels are at 10%.
      tag: percent <= 10 ? `${percent}%` : null,
      lost: `${100 - percent}% of random ${tries} fail here too.`,
      won: `Random ${tries} ${win} this ${percent}% of the time. You are not random.`,
    };
  }
  return {
    big: "WARM-UP", small: `${percent}% of random ${tries} ${win}`, tone: "warm", tag: null,
    // A level every random try wins has no failures to keep a loss company.
    lost: percent < 100 ? `${100 - percent}% of random ${tries} fail here too.` : null,
    won: null,
  };
};
