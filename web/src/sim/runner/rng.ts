// SplitMix64: tiny, fast, and the same sequence on every device for a given seed.
// The state is a 64-bit unsigned integer with wrapping arithmetic, so it is kept as a BigInt.
const MASK = (1n << 64n) - 1n;

export class SeededRNG {
  private state: bigint;

  constructor(seed: bigint | number) {
    this.state = BigInt(seed) & MASK;
  }

  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  }

  /// Uniform in [0, 1). The top 53 bits fit a double exactly.
  unit(): number {
    return Number(this.next() >> 11n) / 2 ** 53;
  }

  /// A whole number from lo to hi, both included.
  int(lo: number, hi: number): number {
    const count = hi - lo + 1;
    return lo + Math.min(count - 1, Math.trunc(this.unit() * count));
  }
}
