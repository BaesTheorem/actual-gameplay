import { describe, expect, it } from "vitest";
import { BOULDER_RADIUS, CRUSH_SPEED } from "../src/sim/pinpull";
import { position, speed } from "../src/sim/sk";
import { FLOOR, doorPin, level, play, ramp } from "./pin-v2-kit";

/// A boulder on a pin 150 points up, in a shaft of its own, over whoever stands at x 210.
const SHAFT = [{ x: 150, y: FLOOR, w: 14, h: 200 }, { x: 250, y: 200, w: 14, h: 80 }];
const HELD = { pins: [{ id: "p1", x: 164, y: 200, w: 100, side: "right" }], boulders: [{ x: 210, y: 233 }] };
const UNDER = { x: 210, y: FLOOR + 16 };
const FAR_EXIT = { x: 38, y: 300, w: 40, h: 40 };

describe("a falling boulder", () => {
  it("is a round rock of radius 18 that rests where it is put", () => {
    const run = play(level({ walls: SHAFT, ...HELD }), [], { seconds: 1 });
    const boulder = run.sim.boulders[0];
    expect(boulder.radius).toBe(BOULDER_RADIUS);
    expect(position(boulder.body).y).toBeCloseTo(233, 0);
    expect(speed(boulder.body)).toBeLessThan(1);
  });

  it("knocks out a goblin", () => {
    const run = play(level({ winWhen: "heroReachesGoal", walls: SHAFT, ...HELD, actors: { hero: { x: 80, y: FLOOR + 16 }, foes: [UNDER], goal: FAR_EXIT } }), ["p1"]);
    expect(run.sim.foes[0].state).toBe("ko");
    expect(run.when("knockout")).toBeGreaterThan(1);
    expect(run.sim.heroState).toBe("idle");
    // The boulder went on down to the floor, and was heard landing.
    expect(position(run.sim.boulders[0].body).y).toBeLessThan(FLOOR + 22);
    expect(run.when("thud")).toBeGreaterThan(1);
  });

  it("kills the hero", () => {
    const run = play(level({ winWhen: "heroReachesGoal", walls: SHAFT, ...HELD, actors: { hero: UNDER, goal: FAR_EXIT } }), ["p1"]);
    expect(run.reason).toBe("Flattened by a boulder.");
    expect(run.sim.heroState).toBe("ko");
    expect(run.when("crush")).toBeGreaterThan(1);
  });

  it("kills the friend", () => {
    const run = play(level({ winWhen: "heroReachesFriend", walls: SHAFT, ...HELD, actors: { hero: { x: 80, y: FLOOR + 16 }, friend: { x: 210, y: FLOOR + 13 } } }), ["p1"]);
    expect(run.reason).toBe("Your friend was flattened.");
    expect(run.sim.friendState).toBe("ko");
  });
});

describe("a slow boulder", () => {
  /// A boulder at the top of a slope of six degrees, held by a door pin, with someone standing
  /// 50 points down the slope from it. It rolls into him at about a walk.
  const gentle = (actors: object) => {
    const tan = Math.tan((6 * Math.PI) / 180);
    // The top face runs from (60, 100) down to (300, 100 - 240 tan 6). The boulder sits on it at x 100.
    const face = (x: number) => 100 - (x - 60) * tan;
    return level({
      winWhen: "heroReachesGoal", walls: [{ x: 300, y: FLOOR, w: 64, h: 60 }], slabs: [ramp(60, face(60), 300, face(300))],
      pins: [{ ...doorPin("p1", 128), y: face(128) + 15 }], boulders: [{ x: 100, y: face(100) + BOULDER_RADIUS + 1 }],
      actors: { goal: { x: 38, y: 400, w: 40, h: 40 }, ...actors },
    });
  };
  const stand = (x: number) => ({ x, y: 100 - (x - 60) * Math.tan((6 * Math.PI) / 180) + 17 });

  it("pushes a goblin and does not knock him out", () => {
    let fastest = 0;
    const lvl = gentle({ foes: [stand(180)] });
    const run = play(lvl, ["p1"], { seconds: 6, each: (sim) => { fastest = Math.max(fastest, speed(sim.boulders[0].body)); } });
    const goblin = run.sim.foes[0];
    expect(fastest).toBeGreaterThan(20);
    expect(fastest).toBeLessThan(CRUSH_SPEED);
    expect(goblin.active).toBe(true);
    // It reached him and shoved him down the slope.
    expect(position(goblin.body).x).toBeGreaterThan(184);
    expect(position(run.sim.boulders[0].body).x).toBeGreaterThan(140);
  });

  it("pushes the hero and does not kill him", () => {
    const run = play(gentle({ hero: stand(180) }), ["p1"], { seconds: 6 });
    expect(run.sim.heroState).toBe("idle");
    expect(run.reason).not.toBe("Flattened by a boulder.");
    expect(position(run.sim.hero!).x).toBeGreaterThan(184);
  });
});

describe("a boulder on a route", () => {
  it("blocks it", () => {
    let walked = false;
    const run = play(level({ boulders: [{ x: 200, y: FLOOR + BOULDER_RADIUS }], actors: { hero: { x: 80, y: FLOOR + 16 }, treasure: { x: 320, y: FLOOR + 11 } } }),
      [], { seconds: 3, each: (sim) => { walked ||= sim.heroWalking; } });
    // The probe meets the boulder before it meets the gem, so there is no route and he never sets off.
    expect(walked).toBe(false);
    expect(position(run.sim.hero!).x).toBeCloseTo(80, 0);
  });

  it("lets liquid flow around it", () => {
    // Water let down on top of a boulder that stands in a trough runs off both sides of it.
    const run = play(level({
      walls: [{ x: 150, y: FLOOR, w: 14, h: 60 }, { x: 250, y: FLOOR, w: 14, h: 60 }, { x: 177, y: 200, w: 14, h: 80 }, { x: 223, y: 200, w: 14, h: 80 }],
      pins: [{ id: "p1", x: 191, y: 200, w: 32, side: "left" }], pools: [{ liquid: "water", x: 193, y: 214, w: 28, h: 60, count: 40 }],
      boulders: [{ x: 207, y: FLOOR + BOULDER_RADIUS }],
    }), ["p1"], { seconds: 6 });
    const boulder = position(run.sim.boulders[0].body), xs = run.sim.particles.map((p) => position(p.body).x);
    expect(xs.filter((x) => x < boulder.x - BOULDER_RADIUS / 2).length).toBeGreaterThan(8);
    expect(xs.filter((x) => x > boulder.x + BOULDER_RADIUS / 2).length).toBeGreaterThan(8);
    // It is still on the floor: the water did not lift it.
    expect(boulder.y).toBeLessThan(FLOOR + BOULDER_RADIUS + 4);
  });
});
