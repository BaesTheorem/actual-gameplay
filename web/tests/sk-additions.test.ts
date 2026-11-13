import { describe, expect, it } from "vitest";
import { SKWorld, applyImpulse, position, setMass, velocity } from "../src/sim/sk";

const A = 1, B = 2;

/// A light body thrown at a heavy one that does not list it. Returns both after the meeting.
const meet = (oneSided: boolean) => {
  const sk = new SKWorld(0, { oneSided });
  const heavy = sk.circle({ kind: "heavy", position: { x: 100, y: 0 }, category: A, collision: A, linearDamping: 0 }, 16);
  const light = sk.circle({ kind: "light", position: { x: 0, y: 0 }, category: B, collision: A, linearDamping: 0 }, 6);
  applyImpulse(light, { x: light.getMass() * 300, y: 0 });
  for (let i = 0; i < 60; i++) sk.step();
  return { heavy, light };
};

describe("sk additions", () => {
  it("leaves a body unmoved by what its collision mask leaves out, when the world is one-sided", () => {
    const { heavy, light } = meet(true);
    expect(position(heavy).x).toBeCloseTo(100, 6);
    expect(velocity(heavy).x).toBeCloseTo(0, 6);
    expect(velocity(light).x).toBeLessThan(0);
  });

  it("pushes both bodies in a world that did not ask for it", () => {
    const { heavy } = meet(false);
    expect(velocity(heavy).x).toBeGreaterThan(1);
  });

  it("sets mass without moving the centre of mass", () => {
    const sk = new SKWorld(0);
    const body = sk.box({ kind: "box", category: A }, 30, 10, { x: 15, y: 0 });
    const before = body.getInertia() / body.getMass();
    setMass(body, 0.5);
    expect(body.getMass()).toBeCloseTo(0.5, 12);
    expect(body.getLocalCenter().x * 150).toBeCloseTo(15, 9);
    expect(body.getInertia() / body.getMass()).toBeCloseTo(before, 9);
  });

  it("finds the bodies under a point", () => {
    const sk = new SKWorld(0);
    const box = sk.box({ kind: "box", dynamic: false, category: A }, 20, 20, { x: 50, y: 50 });
    sk.edgeChain({ kind: "edge", category: A }, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(sk.bodiesAt({ x: 55, y: 45 })).toEqual([box]);
    expect(sk.bodiesAt({ x: 80, y: 50 })).toEqual([]);
    expect(sk.bodiesAt({ x: 50, y: 0 })).toEqual([]);
  });
});
