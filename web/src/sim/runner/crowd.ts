// A crowd of runners as data. `count` is the truth; at most 150 of them have a place, arranged
// on a sunflower spiral around the anchor so any number reads as one blob. A hazard takes the
// runners whose places lie in its span, and the loss is scaled up to the true count.
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

const MAX_VISIBLE = 150;
const SLOT_SPACING = 0.05;
/// Cosine and sine of the golden angle, 2.399963 radians, written out so that every device
/// starts from the same two numbers.
const TURN_COS = -0.7373687228988248, TURN_SIN = 0.6754904636562651;

/// Each slot's offset from the anchor in lane units. The spiral turns by multiplying with one
/// fixed rotation, so a slot is the same double everywhere and so is every hazard's count.
const SLOT_DX: number[] = [0], SLOT_DZ: number[] = [0];
{
  let c = 1, s = 0;
  for (let i = 1; i < MAX_VISIBLE; i++) {
    [c, s] = [c * TURN_COS - s * TURN_SIN, s * TURN_COS + c * TURN_SIN];
    const r = SLOT_SPACING * Math.sqrt(i);
    SLOT_DX.push(r * c);
    SLOT_DZ.push(r * s * 0.6);
  }
}

export class Crowd {
  static readonly maxVisible = MAX_VISIBLE;
  static readonly slotSpacing = SLOT_SPACING;

  count = 0;
  /// The runners that are drawn. Empty for a crowd nobody looks at.
  members: Member[] = [];
  leavers: Leaver[] = [];
  anchorX = 0;
  /// Game time and squash amount of the last update, kept so a pose can be read at any moment.
  time = 0;
  wobble = 0;
  /// How wide the formation is drawn, 1 for its own width. A bridge narrows it and the runners
  /// string out along the road by the same amount. It changes the drawing and nothing else.
  squeeze = 1;
  private squeezeTo = 1;

  /// `facing` is 1 for a crowd that faces screen right, -1 for a mirrored one. A crowd with
  /// `drawn` off keeps its count and its rules and no runners, for runs played with no screen.
  constructor(count: number, public anchorZ: number, readonly facing = 1, readonly drawn = true) {
    this.setCount(count, false);
  }

  /// Formation slot i as an offset from the anchor, in lane units.
  static slot(i: number): { dx: number; dz: number } {
    const at = Math.min(Math.max(i, 0), MAX_VISIBLE - 1);
    return { dx: SLOT_DX[at]!, dz: SLOT_DZ[at]! };
  }

  /// Radius of a formation of `count` runners in lane units.
  static radiusOf(count: number): number { return SLOT_SPACING * Math.sqrt(Math.min(Math.max(count, 0), MAX_VISIBLE)); }

  /// How many of a crowd's places lie in a span, or outside it, with the crowd centred on `anchorX`.
  static placesIn(count: number, anchorX: number, span: Span, outside = false): number {
    const places = Math.min(count, MAX_VISIBLE);
    let hit = 0;
    for (let i = 0; i < places; i++) {
      const x = anchorX + SLOT_DX[i]!;
      if ((x >= span.lo && x <= span.hi) !== outside) hit += 1;
    }
    return hit;
  }

  /// How many runners a span takes from a crowd of `count` centred on `anchorX`: the share of
  /// its places in the span, scaled to the true count, and never less than the places themselves.
  static losses(count: number, anchorX: number, span: Span, outside = false): number {
    const places = Math.min(count, MAX_VISIBLE);
    if (places === 0) return 0;
    const hit = Crowd.placesIn(count, anchorX, span, outside);
    if (hit === 0) return 0;
    return Math.min(count, Math.max(hit, Math.round(count * (hit / places))));
  }

  /// Radius of the visible formation in lane units.
  get radius(): number { return Crowd.radiusOf(this.count); }

  setCount(newCount: number, animated = true) {
    this.count = Math.max(0, newCount);
    if (!this.drawn) return;
    const visible = Math.min(this.count, MAX_VISIBLE);
    while (this.members.length < visible) this.addMember(this.members.length, animated);
    while (this.members.length > visible) this.removeLastMember(animated);
  }

  private addMember(index: number, animated: boolean) {
    this.members.push({
      index,
      x: this.anchorX + (animated ? 0 : SLOT_DX[index]!),
      dz: animated ? 0 : SLOT_DZ[index]!,
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

  /// Lose the runners whose places lie in `span`, or outside it. Returns how many were lost.
  /// With `fall` the lost runners drop out of sight, as off a bridge, where the others fade
  /// where they stood.
  kill(span: Span, outside = false, fall = false): number {
    const killed = Crowd.losses(this.count, this.anchorX, span, outside);
    if (killed === 0) return 0;
    if (this.drawn) {
      const kept: Member[] = [];
      this.members.forEach((member, i) => {
        const x = this.anchorX + SLOT_DX[i]!;
        if ((x >= span.lo && x <= span.hi) !== outside) this.leave(member, fall ? 0.4 : 0.2, fall ? 70 : 20);
        else kept.push(member);
      });
      this.members = kept;
    }
    this.count -= killed;
    // The places that are left close up, so a big crowd that lost its edge shows runners again.
    if (this.drawn) this.setCount(this.count);
    return killed;
  }

  /// Draw the formation at this share of its width from now on. It eases there.
  squeezeToward(share: number) { this.squeezeTo = share; }

  /// Ease every member toward its slot. A tenth of a second covers the whole distance.
  update(dt: number, time: number, wobble: number) {
    this.time = time;
    this.wobble = wobble;
    const k = Math.min(1, 10 * dt);
    this.squeeze += (this.squeezeTo - this.squeeze) * Math.min(1, 6 * dt);
    const across = this.squeeze, along = 1 / Math.max(0.25, this.squeeze);
    this.members.forEach((member, i) => {
      member.x += (this.anchorX + SLOT_DX[i]! * across - member.x) * k;
      member.dz += (SLOT_DZ[i]! * along - member.dz) * k;
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
      // The bob is drawing only: it decides nothing, so a true sine is fine here.
      yScale: scale * (1 + this.wobble * Math.sin(this.time * 16 + member.phase)), // drawing only
    };
  }

  removeAll() {
    this.members = [];
    this.leavers = [];
    this.count = 0;
  }
}
