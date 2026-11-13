// Where a Number Tower stands on the stage, as plain numbers: the size of a room, the street, the
// place the hero waits, how big the figures and the numbers are. Nothing here draws, so the fit of
// every grid can be checked in a test. All of it is in canvas points with y up, as the scenes work.

/// The canvas is 402 points wide. The stage is the part of it between the phone's two bands:
/// canvas y from 34 up to 814, and the HUD takes the top 60 of that.
export const STAGE = { width: 402, bottom: 34, top: 814, hud: 754 };

/// The street the hero starts on, and the top of the grass.
export const GROUND = 62;
/// How thick a wall or a floor is. Half of it lies in the cell on each side.
export const WALL = 8;
/// The plinth under the tower. Its top is the ground floor's floor, and a door at street level
/// is cut into its face.
export const PLINTH = 30;
/// The roof above the top cells: half a wall, then the battlements.
export const MERLON = 9;
export const ROOF = WALL / 2 + MERLON;
/// The width a ladder up the outside of the tower takes.
export const LADDER = 30;
/// How far the plinth stands out past the tower's outside walls.
export const LIP = 4;
/// The hero's place before his first move: the middle of the strip left of the tower.
export const START_X = 38;
/// The grid keeps between these two lines. That leaves the strip on the left to the hero, and
/// room on the right for the outside wall, the plinth's lip and their ink.
const TOWER_LEFT = 84, TOWER_RIGHT = 386;

const CELL_W_MAX = 176, CELL_H_MAX = 190;
/// A cell this low still holds the boss with its number over its head.
export const CELL_H_MIN = 84;
/// The smallest a number is drawn, in points, and the most it grows in a roomy tower.
export const NUMBER_MIN = 15;
const NUMBER_GROWTH = 1.5, FIGURE_GROWTH = 1.3;
/// The cell the smallest sizes were chosen for: three columns across the stage.
const TIGHT_W = 100, TIGHT_H = 96;

export interface Grid { w: number; h: number }

export interface TowerLayout {
  /// One cell of the grid, walls included.
  cellW: number;
  cellH: number;
  /// The left edge of column 0, and the bottom edge of the ground floor's cells.
  left: number;
  base: number;
  /// The top of the battlements.
  top: number;
  /// Where the hero's feet are before his first move.
  start: { x: number; y: number };
  /// How big the painted figures are drawn, from 1 in the tightest grid.
  figure: number;
  /// The size of every number in a room, in points. Never under 15.
  numberSize: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/// Fit a grid between the street and `ceiling`, the lowest thing above the tower (the hint plate,
/// or the plate under it). `ladders` says which sides have a ladder up the outside. A room is as
/// big as the stage allows up to a limit, so a small tower gets big rooms and big numbers. A tower
/// too tall for the ceiling keeps its smallest cell and overlaps what is above it; the test checks
/// that no grid in the game does.
export const towerLayout = (grid: Grid, ceiling: number, ladders = { left: false, right: false }): TowerLayout => {
  const minLeft = TOWER_LEFT + (ladders.left ? LADDER : 0), maxRight = TOWER_RIGHT - (ladders.right ? LADDER : 0);
  const base = GROUND + PLINTH - WALL / 2;
  const cellW = Math.min(CELL_W_MAX, (maxRight - minLeft) / grid.w);
  const cellH = Math.max(CELL_H_MIN, Math.min(CELL_H_MAX, cellW * 1.45, (ceiling - ROOF - base) / grid.h));
  const scale = Math.min(cellW / TIGHT_W, cellH / TIGHT_H);
  return {
    cellW, cellH, base,
    left: minLeft + (maxRight - minLeft - cellW * grid.w) / 2,
    top: base + cellH * grid.h + ROOF,
    start: { x: START_X, y: GROUND },
    figure: clamp(scale, 1, FIGURE_GROWTH),
    numberSize: Math.round(NUMBER_MIN * clamp(scale, 1, NUMBER_GROWTH)),
  };
};

/// The rectangle of a cell, walls included: its lower left corner and its size.
export const cellRect = (layout: TowerLayout, grid: Grid, room: number) => ({
  x: layout.left + (room % grid.w) * layout.cellW,
  y: layout.base + Math.floor(room / grid.w) * layout.cellH,
  w: layout.cellW,
  h: layout.cellH,
});

/// The cell a canvas point is in, or -1 outside the grid.
export const cellAt = (layout: TowerLayout, grid: Grid, x: number, y: number): number => {
  const column = Math.floor((x - layout.left) / layout.cellW), floor = Math.floor((y - layout.base) / layout.cellH);
  return column >= 0 && column < grid.w && floor >= 0 && floor < grid.h ? floor * grid.w + column : -1;
};

/// Where the things in a room stand, as a share of the room's inside width, left to right in the
/// order they resolve. The left of the room is kept for the hero, who walks in from that side.
export const slotShares = (count: number): number[] => (count <= 1 ? [0.6] : [0.42, 0.78]);
