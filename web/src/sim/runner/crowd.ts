// A crowd of runners as data. `count` is the truth; at most 150 of them are members with a place,
// arranged on a sunflower spiral around the anchor so any number reads as one blob.
import type { Vec } from "../sk";
import { Projection } from "./projection";
import type { Span } from "./track";

export interface Member {
  /// The slot the member was made for. Its place in the formation can move down when others die.
  index: number;
  x: number;
  dz: number;
  /// Offset into the squash cycle, so the crowd does not bob in lockstep.
  phase: number;
  /// Seconds since the member joined.
  age: number;
  /// True for a member that joined during play: it starts on the anchor and fades in over 0.15 s.
  fadeIn: boolean;
}

/// A member on its way out, for the draw layer: it stays where it left and fades as it drops.
export interface Leaver {
  x: number;
  z: number;
  phase: number;
  age: number;
  /// Seconds the fade takes, and how many points the sprite drops in that time.
  duration: number;
  drop: number;
}

export interface MemberPose { position: Vec; zPosition: number; xScale: number; yScale: number }

export class Crowd {
  static readonly maxVisible = 150;
  static readonly slotSpacing = 0.05;

  count = 0;
  members: Member[] = [];
  leavers: Leaver[] = [];
  anchorX = 0;
  /// Game time and squash amount of the last update, kept so a pose can be read at any moment.
  time = 0;
  wobble = 0;

  /// `facing` is 1 for a crowd that faces screen right, -1 for a mirrored one.
  constructor(count: number, public anchorZ: number, readonly facing = 1) {
    this.setCount(count, false);
  }

  /// Formation slot i as an offset from the anchor, in lane units.
  static slot(i: number): { dx: number; dz: number } {
    if (i <= 0) return { dx: 0, dz: 0 };
    const r = Crowd.slotSpacing * Math.sqrt(i);
    const angle = i * 2.399963;
    return { dx: r * Math.cos(angle), dz: r * Math.sin(angle) * 0.6 };
  }

  /// Radius of the visible formation in lane units.
  get radius(): number { return Crowd.slotSpacing * Math.sqrt(Math.min(this.count, Crowd.maxVisible)); }

  setCount(newCount: number, animated = true) {
    this.count = Math.max(0, newCount);
    const visible = Math.min(this.count, Crowd.maxVisible);
    while (this.members.length < visible) this.addMember(this.members.length, animated);
    while (this.members.length > visible) this.removeLastMember(animated);
  }

  private addMember(index: number, animated: boolean) {
    const slot = Crowd.slot(index);
    this.members.push({
      index,
      x: this.anchorX + (animated ? 0 : slot.dx),
      dz: animated ? 0 : slot.dz,
      phase: index * 0.7,
      age: 0,
      fadeIn: animated,
    });
  }

  private removeLastMember(animated: boolean) {
    const member = this.members.pop()!;
    if (animated) this.leave(member, 0.25, 24);
  }

  private leave(member: Member, duration: number, drop: number) {
    this.leavers.push({ x: member.x, z: this.anchorZ + member.dz, phase: member.phase, age: 0, duration, drop });
  }

  /// Kill the members inside `span` and scale the loss up to the true count.
  kill(span: Span): number {
    if (this.members.length === 0) return 0;
    const hit = this.members.filter((m) => m.x >= span.lo && m.x <= span.hi);
    if (hit.length === 0) return 0;
    const fraction = hit.length / this.members.length;
    const killed = Math.min(this.count, Math.max(hit.length, Math.round(this.count * fraction)));
    for (const member of hit) this.leave(member, 0.2, 20);
    this.members = this.members.filter((m) => !hit.includes(m));
    this.count -= killed;
    return killed;
  }

  /// Ease every member toward its slot. A tenth of a second covers the whole distance.
  update(dt: number, time: number, wobble: number) {
    this.time = time;
    this.wobble = wobble;
    const k = Math.min(1, 10 * dt);
    this.members.forEach((member, i) => {
      const slot = Crowd.slot(i);
      member.x += (this.anchorX + slot.dx - member.x) * k;
      member.dz += (slot.dz - member.dz) * k;
      member.age += dt;
    });
    if (this.leavers.length > 0) {
      for (const leaver of this.leavers) leaver.age += dt;
      this.leavers = this.leavers.filter((l) => l.age < l.duration);
    }
  }

  /// Where a member is drawn and how it is squashed, as of the last update.
  pose(member: Member): MemberPose {
    const z = this.anchorZ + member.dz;
    const scale = Projection.scale(z);
    return {
      position: Projection.point(member.x, z),
      zPosition: 100 - z,
      xScale: scale * this.facing,
      yScale: scale * (1 + this.wobble * Math.sin(this.time * 16 + member.phase)),
    };
  }

  removeAll() {
    this.members = [];
    this.leavers = [];
    this.count = 0;
  }
}
