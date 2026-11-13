// A small seeded generator (mulberry32). It uses only 32 bit integer arithmetic and one division
// by 2^32, so Node and every browser give the same numbers for the same seed.

/// Fold a string into a 32 bit seed (FNV-1a).
export const hashSeed = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === "string" ? hashSeed(seed) : seed) >>> 0;
    // Warm up so that small neighbouring seeds do not start alike.
    this.next();
    this.next();
  }

  /// A number from 0 up to, not including, 1.
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /// A whole number from lo to hi, both included.
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /// A number from lo up to, not including, hi.
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /// One key of the table, chosen in proportion to its weight. Keys with no weight never come up.
  weighted<K extends string>(table: Partial<Record<K, number>>): K {
    const keys = (Object.keys(table) as K[]).filter((k) => (table[k] ?? 0) > 0);
    if (keys.length === 0) throw new Error("weighted: the table has no positive weight");
    let total = 0;
    for (const k of keys) total += table[k] as number;
    let roll = this.next() * total;
    for (const k of keys) {
      roll -= table[k] as number;
      if (roll < 0) return k;
    }
    return keys[keys.length - 1] as K;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}
