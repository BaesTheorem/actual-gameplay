// Worlds: every five runs is one, with a boss at its end, its own look, and its own pieces.
// The look is a name here and colours in the scene. After the fourth world the looks come round
// again and the numbers keep growing.

/// Runs in a world. The last one ends on a boss.
export const RUNS_PER_WORLD = 5;

export const WORLD_NAMES = ["Meadow", "Dunes", "Snow", "Night"] as const;
export type WorldName = (typeof WORLD_NAMES)[number];

export interface World {
  /// Counted from 0: runs 1 to 5 are world 0.
  index: number;
  /// Which of the four looks it wears.
  look: number;
  name: WorldName;
}

/// The world a run belongs to. `level` is the run counted from 0.
export const worldOf = (level: number): World => {
  const index = Math.floor(Math.max(0, level) / RUNS_PER_WORLD);
  const look = index % WORLD_NAMES.length;
  return { index, look, name: WORLD_NAMES[look]! };
};

/// True for the run that ends a world: every fifth one.
export const isBossRun = (level: number): boolean => (level + 1) % RUNS_PER_WORLD === 0;

/// "World 2, Dunes. Run 7", for the hub.
export const worldTitle = (level: number): string => {
  const world = worldOf(level);
  return `World ${world.index + 1}, ${world.name}. Run ${level + 1}`;
};

/// Which pieces a world's runs can hold. World 1 teaches gates and crates, world 2 adds what
/// needs firepower and a steady hand, world 3 adds what needs timing, and from world 4 on a run
/// can hold anything.
export interface WorldPieces {
  rateGates: boolean;
  rangeGates: boolean;
  slidingGates: boolean;
  rateCrates: boolean;
  squads: boolean;
  walls: boolean;
  spikes: boolean;
  blades: boolean;
  barrels: boolean;
  hammers: boolean;
  bridges: boolean;
}

export const worldPieces = (world: number): WorldPieces => ({
  rateGates: world >= 1,
  slidingGates: world >= 1,
  rateCrates: world >= 1,
  squads: world >= 1,
  walls: world >= 1,
  spikes: world >= 1,
  rangeGates: world >= 2,
  blades: world >= 2,
  barrels: world >= 2,
  hammers: world >= 2,
  bridges: world >= 2,
});
