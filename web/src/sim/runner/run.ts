// A run as the game starts it: the track for the run number, the par for the player's own
// upgrades, and the simulation.
import type { Emit } from "../clock";
import { parOf } from "./bots";
import type { RunnerEconomy } from "./economy";
import { RunnerGenerator } from "./generator";
import { RunnerSim } from "./sim";

/// Start 0-based run `level` with the player's upgrades. The track is generated and checked
/// here, and the skilled bot plays it once more at these upgrades so the stars can be measured
/// against a clean run with what the player owns.
export const startRun = (level: number, economy: RunnerEconomy, emit: Emit | null = null): RunnerSim => {
  const track = RunnerGenerator.makeTrack(level);
  return new RunnerSim(track, economy, emit, { par: parOf(track, economy) });
};
