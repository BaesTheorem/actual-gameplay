/// Game-time timers, for the delays the scenes ran as actions (a death that plays out before
/// the level ends, a slide that takes a quarter second). Time only moves when the sim steps.
export class Clock {
  now = 0;
  private pending: { at: number; run: () => void }[] = [];

  after(seconds: number, run: () => void) {
    this.pending.push({ at: this.now + seconds, run });
  }

  advance(dt: number) {
    this.now += dt;
    if (this.pending.length === 0) return;
    const due = this.pending.filter((t) => t.at <= this.now);
    if (due.length === 0) return;
    this.pending = this.pending.filter((t) => t.at > this.now);
    for (const t of due) t.run();
  }
}

/// What a simulation tells the layer that draws and plays sound. The sim never waits on it.
export type Cue =
  | { type: "sound"; name: string }
  | { type: "puff"; x: number; y: number }
  | { type: "haptic"; name: string }
  | { type: "mood"; who: unknown; clip: string }
  /// A sound that runs until it is stopped. `volume` is 0 to 1 and can change while it runs.
  | { type: "loop"; name: string; on: boolean; volume: number };
export type Emit = (cue: Cue) => void;
