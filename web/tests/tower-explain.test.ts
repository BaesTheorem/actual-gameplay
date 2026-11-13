// The one-line explanations of Number Tower's pieces, and which level shows each one first.
import { describe, expect, it } from "vitest";
import { load } from "../scripts/levels";
import { EXPLAINED, EXPLAINERS, explainedIn, firstAppearances, type Room, type Thing, type TowerLevel } from "../src/sim/tower";

const campaign = load<TowerLevel & { id: string }>("tower");

const room = (things: Thing[], extra: Partial<Room> = {}): Room => ({ things, ...extra });

describe("the explanations", () => {
  it("has one dry sentence for every piece", () => {
    for (const piece of EXPLAINED) {
      const line = EXPLAINERS[piece];
      expect(line.length, piece).toBeGreaterThan(10);
      expect(line.endsWith("."), piece).toBe(true);
      expect(line.includes("!"), piece).toBe(false);
    }
    expect(Object.keys(EXPLAINERS).sort()).toEqual([...EXPLAINED].sort());
  });

  it("lists what a level has, in the order the lines are shown", () => {
    const level: TowerLevel = {
      id: "t", name: "T", start: 5, w: 2, h: 2,
      rooms: [
        room([{ kind: "key" }]),
        room([{ kind: "times", k: 3 }], { max: 5 }),
        room([{ kind: "mirror" }], { locked: true }),
        room([{ kind: "boss", n: 9 }]),
      ],
      walls: [[0, 1]], entries: [0], solution: [], best: 0,
    };
    expect(explainedIn(level)).toEqual(["entry", "boss", "times", "mirror", "key", "lock", "limit", "wall"]);
  });

  it("gives a level with nothing special only the way in and what it holds", () => {
    const level: TowerLevel = {
      id: "t", name: "T", start: 5, w: 1, h: 2,
      rooms: [room([{ kind: "enemy", n: 2 }]), room([{ kind: "boss", n: 6 }])],
      walls: [], entries: [0, 1], solution: [], best: 0,
    };
    expect(explainedIn(level)).toEqual(["entry", "enemy", "boss"]);
  });
});

describe("first appearances in the campaign", () => {
  const fresh = firstAppearances(campaign);

  it("explains every piece the campaign uses exactly once, in the first level that has it", () => {
    const told = fresh.flat();
    expect(new Set(told).size).toBe(told.length);
    const used = new Set(campaign.flatMap((level) => explainedIn(level)));
    expect(new Set(told)).toEqual(used);
    for (const [index, pieces] of fresh.entries()) {
      for (const piece of pieces) {
        expect(explainedIn(campaign[index])).toContain(piece);
        for (const earlier of campaign.slice(0, index)) expect(explainedIn(earlier), `${piece} before ${campaign[index].id}`).not.toContain(piece);
      }
    }
  });

  it("teaches the way in, a rival and the boss on the first level", () => {
    expect(fresh[0]).toContain("entry");
    expect(fresh[0]).toContain("boss");
  });

  it("explains the mirror, which no level hint does", () => {
    const at = fresh.findIndex((pieces) => pieces.includes("mirror"));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(campaign[at].rooms.some((r) => r?.things.some((thing) => thing.kind === "mirror"))).toBe(true);
  });

  it("never asks a level to explain more than five things at once", () => {
    for (const [index, pieces] of fresh.entries()) expect(pieces.length, campaign[index].id).toBeLessThanOrEqual(5);
  });
});
