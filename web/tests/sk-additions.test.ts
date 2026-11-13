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

  it("casts a ray to the first body in its way, among the categories asked for", () => {
    const sk = new SKWorld(0);
    const near = sk.box({ kind: "near", dynamic: false, category: A }, 20, 20, { x: 50, y: 0 });
    const far = sk.box({ kind: "far", dynamic: false, category: B }, 20, 20, { x: 100, y: 0 });
    const hit = sk.rayCast({ x: 0, y: 0 }, { x: 200, y: 0 }, A | B);
    expect(hit?.body === near).toBe(true);
    expect(hit?.point.x).toBeCloseTo(40, 6);
    expect(hit?.point.y).toBeCloseTo(0, 6);
    // Only B: the ray goes through the first box as if it were not there.
    expect(sk.rayCast({ x: 0, y: 0 }, { x: 200, y: 0 }, B)?.body === far).toBe(true);
    expect(sk.rayCast({ x: 0, y: 0 }, { x: 30, y: 0 }, A | B)).toBeNull();
    expect(sk.rayCast({ x: 0, y: 40 }, { x: 200, y: 40 }, A | B)).toBeNull();
    // A body that has been taken out of the world is not in the way, even before the step that destroys it.
    sk.remove(near);
    expect(sk.rayCast({ x: 0, y: 0 }, { x: 200, y: 0 }, A | B)?.body === far).toBe(true);
  });

  it("says what is touching a body, for pairs that report without colliding too", () => {
    const sk = new SKWorld(-6);
    const floor = sk.box({ kind: "floor", dynamic: false, category: A }, 200, 10, { x: 0, y: -5 });
    // A strip over the floor that pushes nothing and asks to hear about B.
    const strip = sk.box({ kind: "strip", dynamic: false, category: 4, collision: 0, contactTest: B }, 40, 5, { x: 0, y: 2.5 });
    const ball = sk.circle({ kind: "ball", position: { x: 0, y: 30 }, category: B, collision: A }, 8);
    expect(sk.touching(strip)).toEqual([]);
    for (let i = 0; i < 90; i++) sk.step();
    expect(sk.touching(strip).length).toBe(1);
    expect(sk.touching(strip)[0] === ball).toBe(true);
    expect(sk.touching(ball).length).toBe(2);
    expect(sk.touching(ball).includes(floor) && sk.touching(ball).includes(strip)).toBe(true);
    // The strip did not hold it up: it rests on the floor.
    expect(position(ball).y).toBeLessThan(10);
    sk.remove(ball);
    expect(sk.touching(strip)).toEqual([]);
  });

  it("finds the moving bodies in a rectangle", () => {
    const sk = new SKWorld(0);
    sk.box({ kind: "wall", dynamic: false, category: A }, 20, 20, { x: 10, y: 10 });
    const inside = sk.circle({ kind: "in", position: { x: 30, y: 10 }, category: A }, 5);
    const edge = sk.circle({ kind: "edge", position: { x: 53, y: 10 }, category: A }, 5);
    sk.circle({ kind: "out", position: { x: 60, y: 10 }, category: A }, 5);
    sk.circle({ kind: "corner", position: { x: 56, y: 26 }, category: A }, 5);
    // The rectangle runs from x 0 to x 50. The wall in it does not move, so it is not found.
    const found = sk.movingIn({ x: 0, y: 0, w: 50, h: 20 });
    expect(found.length).toBe(2);
    expect(found.includes(inside) && found.includes(edge)).toBe(true);
  });
});
