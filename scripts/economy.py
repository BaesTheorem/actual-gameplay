#!/usr/bin/env python3
"""Crowd Run's upgrade economy as arithmetic: win odds, coins, and what each upgrade buys.

Ports the track generator (SplitMix64 included) and the scene's rules for gates, hazards and the
finale fight, then plays every run as a probability tree for an imperfect player: the better gate
with probability `skill`, a clean dodge with the same probability, otherwise the crowd stays where
the last gate put it. No simulator involved.

    scripts/economy.py                 the old economy's numbers, the new curve, and a check of the Swift table
    scripts/economy.py --write-swift   design the curve and write it into RunnerEconomy.swift
    scripts/economy.py --grid          also write build/economy/grid.csv: every upgrade state, runs 1-60
    scripts/economy.py --verify        compile the Swift sources and diff tracks, fights and prices against this port

Old rules are the game before this model (rivals grew with the start crowd, the fight rounded each
tick's loss up to a whole runner, coins paid per survivor). New rules are what the Swift runs now.
"""
from __future__ import annotations

import csv
import functools
import math
import os
import pathlib
import re
import statistics
import subprocess
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass, replace

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNNER = ROOT / "ActualGameplay/Sources/Runner"
ECONOMY_SWIFT = RUNNER / "RunnerEconomy.swift"
BASE_CROWD = 5            # RunnerGenerator.baseCrowd: the crowd before upgrades

# --------------------------------------------------------------------------- the generator

MASK = (1 << 64) - 1


class SplitMix64:
    """SeededRNG.swift, bit for bit."""

    def __init__(self, seed: int) -> None:
        self.state = seed & MASK

    def next(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
        return z ^ (z >> 31)

    def unit(self) -> float:
        return (self.next() >> 11) / float(1 << 53)

    def int_in(self, lo: int, hi: int) -> int:
        count = hi - lo + 1
        return lo + min(count - 1, int(self.unit() * count))


Op = tuple[str, int]              # ("+", 7), ("-", 3), ("x", 2), ("/", 3)
Hazard = tuple                    # ("wall", x0, x1), ("blade", c, hw, amp, speed), ("spikes", x0, x1)


def apply(op: Op, count: int) -> int:
    kind, n = op
    if kind == "+":
        return count + n
    if kind == "-":
        return max(0, count - n)
    if kind == "x":
        return count * n
    return max(0, count // n)


def is_good(op: Op) -> bool:
    return op[0] in "+x"


def span(hazard: Hazard, time: float) -> tuple[float, float]:
    if hazard[0] == "blade":
        _, center, half, amplitude, speed = hazard
        x = center + amplitude * math.sin(time * speed)
        return x - half, x + half
    return hazard[1], hazard[2]


@dataclass(frozen=True)
class Track:
    level: int
    segments: tuple        # ("gates", z, left, right) or ("obstacle", z, hazard)
    boss: bool
    strength: int
    finale_z: float
    speed: float
    best: int


def seed_for(level: int) -> int:
    return (1_000_003 * (level + 1)) & MASK


def speed_for(level: int) -> float:
    return min(7 + 0.15 * level, 12.0)


def random_op(rng: SplitMix64, tier: int, force_good: bool = False) -> Op:
    roll = rng.unit()
    if force_good:
        kind = 0 if roll < 0.65 else 2
    elif roll < 0.4:
        kind = 0
    elif roll < 0.65:
        kind = 1
    elif roll < 0.85:
        kind = 2
    else:
        kind = 3
    if kind == 0:
        return ("+", rng.int_in(3 + 2 * tier, 10 + 5 * tier))
    if kind == 1:
        return ("-", rng.int_in(2 + tier, 6 + 3 * tier))
    if kind == 2:
        return ("x", 3 if tier >= 2 and rng.unit() < 0.3 else 2)
    return ("/", 2 if rng.unit() < 0.7 else 3)


def random_hazard(rng: SplitMix64, tier: int) -> Hazard:
    roll = rng.unit()
    if roll < 0.45:
        width = 0.5 + 0.08 * tier
        center = rng.unit() - 0.5
        return ("wall", center - width / 2, center + width / 2)
    if roll < 0.75:
        return ("blade", 0.0, 0.18 + 0.02 * tier, 0.55, 1.4 + 0.2 * tier)
    center = rng.unit() * 1.2 - 0.6
    return ("spikes", center - 0.16, center + 0.16)


def make_track(level: int, start_crowd: int, rivals_grow: bool = False) -> Track:
    """RunnerGenerator.makeTrack. `rivals_grow` sizes the finale from the upgraded crowd, as the
    generator did before; the Swift now sizes it from the base crowd."""
    rng = SplitMix64(seed_for(level))
    count = min(6 + level // 2, 14)
    tier = min(level // 5, 4)
    segments: list[tuple] = []
    z = 12.0
    running = BASE_CROWD
    better_side = 0
    same_side_run = 0
    for _ in range(count):
        if level < 2 or rng.unit() < 0.7:
            left = random_op(rng, tier)
            right = random_op(rng, tier, force_good=not is_good(left))
            tries = 0
            while right == left and tries < 20:
                right = random_op(rng, tier, force_good=not is_good(left))
                tries += 1
            side = 1 if apply(right, running) >= apply(left, running) else -1
            if side == better_side and same_side_run >= 2:
                left, right = right, left
                side = -side
            same_side_run = same_side_run + 1 if side == better_side else 1
            better_side = side
            running = max(apply(left, running), apply(right, running))
            segments.append(("gates", z, left, right))
        else:
            segments.append(("obstacle", z, random_hazard(rng, tier)))
        z += 6
    best, par = start_crowd, BASE_CROWD
    for segment in segments:
        if segment[0] == "gates":
            best = max(apply(segment[2], best), apply(segment[3], best))
            par = max(apply(segment[2], par), apply(segment[3], par))
    best, par = max(best, 2), max(par, 2)
    size = best if rivals_grow else par
    boss = (level + 1) % 5 == 0
    if boss:
        strength = max(1, min(size - 1, math.floor(0.75 * size)))
    else:
        ratio = 0.6 + 0.02 * min(level, 12)
        strength = max(1, min(size - 1, math.floor(size * ratio)))
    return Track(level, tuple(segments), boss, strength, z + 4, speed_for(level), best)


# ------------------------------------------------------------------- the scene's rules

ANCHOR_Z = 2.0            # Projection.anchorZ: where the crowd meets gates and hazards
MAX_VISIBLE = 150         # Crowd.maxVisible: hazards kill a share of the drawn runners
SLOT_DX = [0.0] + [0.05 * math.sqrt(i) * math.cos(i * 2.399963) for i in range(1, MAX_VISIBLE)]


def swift_round(x: float) -> int:
    """Double.rounded() for a non-negative value: halves go up."""
    whole = math.floor(x)
    return whole + 1 if x - whole >= 0.5 else whole


def swift_round_many(x: np.ndarray) -> np.ndarray:
    whole = np.floor(x)
    return (whole + (x - whole >= 0.5)).astype(np.int64)


def kill(count: int, members: int, anchor: float, x0: float, x1: float) -> tuple[int, int]:
    """Crowd.kill(inside:): runners killed, and drawn runners hit, with the crowd centred on `anchor`."""
    hit = sum(1 for dx in SLOT_DX[:members] if x0 <= anchor + dx <= x1)
    if hit == 0:
        return 0, 0
    return min(count, max(hit, swift_round(count * (hit / members)))), hit


def dodge(count: int, x0: float, x1: float) -> float:
    """Where the greedy autopilot parks the crowd for a hazard: the middle of the roomier side."""
    radius = 0.05 * math.sqrt(min(count, MAX_VISIBLE)) + 0.08
    if (x0 - radius) + 0.9 >= 0.9 - (x1 + radius):
        return max(-0.85, (x0 - radius - 0.9) / 2)
    return min(0.85, (x1 + radius + 0.9) / 2)


def fight(mine: int, theirs: int, power: float, carry: bool = True) -> int:
    """FinaleFight.survivors: survivors of the finale, 0 for a loss.

    `carry` is the Swift's fight: the fraction of a runner that dividing by power leaves is paid
    when the fractions add up. The old fight rounded every tick's loss up to a whole runner, so
    power changed nothing until a tick's slice was big enough to round down. At power 1 they agree.
    """
    owed = 0.0
    while True:
        cut = max(1, math.ceil(max(mine, theirs) / 30))
        if carry:
            owed += cut / power
            loss = math.floor(owed)
            owed -= loss
        else:
            loss = max(1, math.ceil(cut / power))
        left_theirs = max(0, theirs - cut)
        left_mine = max(0, mine - loss)
        if left_theirs <= 0 and left_mine > 0:
            return left_mine
        if left_mine <= 0 and left_theirs > 0:
            return 0
        if left_mine <= 0 and left_theirs <= 0:
            return 1 if mine * power >= theirs else 0
        mine, theirs = left_mine, left_theirs


def fight_many(mine: np.ndarray, theirs: int, power: float, carry: bool) -> np.ndarray:
    """`fight` for a whole array of arriving crowds at once, with the same float operations."""
    mine = mine.astype(np.int64)
    rivals = np.full(mine.shape, theirs, dtype=np.int64)
    owed = np.zeros(mine.shape)
    out = np.zeros(mine.shape, dtype=np.int64)
    live = np.arange(mine.size)
    while live.size:
        m, t, o = mine[live], rivals[live], owed[live]
        cut = np.maximum(1, -(-np.maximum(m, t) // 30))
        if carry:
            o = o + cut / power
            loss = np.floor(o).astype(np.int64)
            o = o - loss
        else:
            loss = np.maximum(1, np.ceil(cut / power).astype(np.int64))
        t2 = np.maximum(0, t - cut)
        m2 = np.maximum(0, m - loss)
        won = (t2 <= 0) & (m2 > 0)
        both = (m2 <= 0) & (t2 <= 0)
        out[live[won]] = m2[won]
        out[live[both]] = np.where(m[both] * power >= t[both], 1, 0)
        mine[live], rivals[live], owed[live] = m2, t2, o
        live = live[(m2 > 0) & (t2 > 0)]
    return out


# ------------------------------------------------------------------- the player

@functools.cache
def track(level: int, start: int, rivals_grow: bool = False) -> Track:
    return make_track(level, start, rivals_grow)


@functools.cache
def arrival(level: int, start: int, skill: float) -> tuple[np.ndarray, np.ndarray, float]:
    """The crowds that reach the finale and their probabilities, and the chance none does.

    The player takes the better gate with probability `skill` and otherwise the worse one. At a
    hazard they dodge like the autopilot with the same probability; otherwise the crowd stays where
    the last gate or dodge left it (x = +-0.5 after a gate, 0 at the start line).
    """
    tr = track(level, start)
    states: dict[tuple[int, int, float], float] = {(start, min(start, MAX_VISIBLE), 0.0): 1.0}
    lost = 0.0
    for seg in tr.segments:
        nxt: dict[tuple[int, int, float], float] = defaultdict(float)
        if seg[0] == "gates":
            left, right = seg[2], seg[3]
            for (count, _, _), prob in states.items():
                a, b = apply(left, count), apply(right, count)
                if a == b:
                    options = [(a, -0.5, 1.0)]
                elif a > b:
                    options = [(a, -0.5, skill), (b, 0.5, 1 - skill)]
                else:
                    options = [(b, 0.5, skill), (a, -0.5, 1 - skill)]
                for n, x, w in options:
                    if w <= 0:
                        continue
                    if n == 0:
                        lost += prob * w
                    else:
                        nxt[(n, min(n, MAX_VISIBLE), x)] += prob * w
        else:
            x0, x1 = span(seg[2], (seg[1] - ANCHOR_Z) / tr.speed)
            for (count, members, x), prob in states.items():
                for anchor, w in ((dodge(count, x0, x1), skill), (x, 1 - skill)):
                    if w <= 0:
                        continue
                    killed, hit = kill(count, members, anchor, x0, x1)
                    if killed >= count:
                        lost += prob * w
                    else:
                        nxt[(count - killed, members - hit, anchor)] += prob * w
        states = nxt
    arrive: dict[int, float] = defaultdict(float)
    for (count, _, _), prob in states.items():
        arrive[count] += prob
    counts = np.array(sorted(arrive), dtype=np.int64)
    probs = np.array([arrive[c] for c in counts.tolist()])
    counts.flags.writeable = False
    probs.flags.writeable = False
    return counts, probs, lost


@functools.cache
def finale(level: int, start: int, power: float, skill: float, rivals_grow: bool,
           carry: bool) -> tuple[float, np.ndarray, np.ndarray, np.ndarray]:
    """P(win), then the winning outcomes as arrays: survivors, stars, probability."""
    counts, probs, _ = arrival(level, start, skill)
    tr = track(level, start, rivals_grow)
    alive = fight_many(counts, tr.strength, power, carry)
    won = alive > 0
    share = alive[won] / max(1.0, tr.best - tr.strength / power)
    stars = np.where(share >= 0.85, 3, np.where(share >= 0.5, 2, 1))
    return float(probs[won].sum()), alive[won], stars, probs[won]


# ------------------------------------------------------------------- economies

UPGRADES = ("startCrowd", "memberPower", "coinMultiplier")
NAMES = ("start crowd", "strength", "coin bonus")
MAX_LEVEL = (20, 10, 10)
SKILLS = (0.7, 0.8, 0.9)
REFERENCE_SKILL = 0.8
SECONDS_PER_RUN = 15.0
STAR_SHARE = np.array([0.0, 0.5, 0.75, 1.0])    # RunnerEconomy.starShare
WINDOW = 10                                     # runs averaged when quoting odds or income


def purse(level: int) -> int:
    """RunnerEconomy.purse: a three-star win of 0-based `level` before the coin bonus."""
    return 30 + 3 * level


@dataclass(frozen=True)
class Rules:
    name: str
    start: tuple[int, ...]          # crowd at each startCrowd level
    power: tuple[float, ...]        # member power at each memberPower level
    mult: tuple[float, ...]         # coin multiplier at each coinMultiplier level
    rivals_grow: bool               # finale sized from the upgraded crowd
    carry: bool                     # the fight carries fractional losses
    purse_coins: bool               # coins from the run's purse and stars, not per survivor
    costs: tuple[tuple[int, ...], ...]   # costs[u][n]: the price of level n -> n + 1

    def coins(self, level: int, alive: np.ndarray, stars: np.ndarray, mult: float) -> np.ndarray:
        if self.purse_coins:
            return swift_round_many(purse(level) * STAR_SHARE[stars] * mult)
        return swift_round_many(alive * mult) + 10


def old_cost(base: float, growth: float, levels: int) -> tuple[int, ...]:
    return tuple(swift_round(base * growth ** n) for n in range(levels))


OLD = Rules(
    name="old",
    start=tuple(5 + 2 * n for n in range(21)),
    power=tuple(1 + 0.15 * n for n in range(11)),
    mult=tuple(1 + 0.2 * n for n in range(11)),
    rivals_grow=True,
    carry=False,
    purse_coins=False,
    costs=(old_cost(50, 1.35, 20), old_cost(80, 1.4, 10), old_cost(60, 1.4, 10)),
)

NEW_EFFECTS = replace(OLD, name="new", rivals_grow=False, carry=True, purse_coins=True, costs=((), (), ()))

Levels = tuple[int, int, int]       # upgrade levels (startCrowd, memberPower, coinMultiplier)


@dataclass(frozen=True)
class Stats:
    p_win: float
    survivors: float        # expected survivors given a win
    per_win: float          # expected coins given a win
    per_run: float          # expected coins per attempt, losses included

    @property
    def per_minute(self) -> float:
        return self.per_run * 60 / SECONDS_PER_RUN


def outcome_stats(rules: Rules, level: int, result: tuple, mult: float) -> Stats:
    p, alive, stars, probs = result
    if p <= 0:
        return Stats(0.0, 0.0, 0.0, 0.0)
    coins = rules.coins(level, alive, stars, mult)
    per_win = float((coins * probs).sum()) / p
    return Stats(p, float((alive * probs).sum()) / p, per_win, p * per_win)


def stats(rules: Rules, level: int, lv: Levels, skill: float) -> Stats:
    result = finale(level, rules.start[lv[0]], rules.power[lv[1]], skill, rules.rivals_grow, rules.carry)
    return outcome_stats(rules, level, result, rules.mult[lv[2]])


def mean_stats(rules: Rules, level: int, lv: Levels, skill: float, width: int = WINDOW) -> Stats:
    """`stats` averaged over `width` runs from `level`."""
    runs = [stats(rules, i, lv, skill) for i in range(level, level + width)]
    return Stats(*(sum(getattr(r, f) for r in runs) / width for f in ("p_win", "survivors", "per_win", "per_run")))


def bump(lv: Levels, u: int) -> Levels:
    out = list(lv)
    out[u] += 1
    return (out[0], out[1], out[2])


@dataclass
class Buy:
    run: int            # 1-based run just won when the purchase is made
    upgrade: int
    tier: int           # the level bought
    cost: int
    before: Stats       # the next WINDOW runs without it
    after: Stats        # and with it

    @property
    def wins(self) -> float:
        """Price in winning runs of income."""
        return self.cost / self.before.per_win

    @property
    def runs(self) -> float:
        """Price in runs of income, losses included."""
        return self.cost / self.before.per_run

    @property
    def odds(self) -> float:
        return self.after.p_win - self.before.p_win


@dataclass
class Walk:
    rules: Rules
    skill: float
    rows: list[tuple[int, Levels, Stats, float]]    # (run, levels, stats, attempts so far)
    buys: list[Buy]


def walk(rules: Rules, skill: float, runs: int = 60) -> Walk:
    """A player who clears one run per win and buys whatever is cheapest the moment they can.

    Expected values throughout: a run is replayed until it is won (1 / P(win) attempts), a loss
    pays nothing, and each win banks the expected coins of a win.
    """
    lv: Levels = (0, 0, 0)
    bank = 0.0
    played = 0.0
    rows: list[tuple[int, Levels, Stats, float]] = []
    buys: list[Buy] = []
    for level in range(runs):
        st = stats(rules, level, lv, skill)
        played += 1 / max(st.p_win, 1e-9)
        bank += st.per_win
        rows.append((level + 1, lv, st, played))
        while True:
            options = [(rules.costs[u][lv[u]], u) for u in range(3) if lv[u] < MAX_LEVEL[u]]
            if not options or min(options)[0] > bank:
                break
            cost, u = min(options)
            after = bump(lv, u)
            buys.append(Buy(level + 1, u, after[u], cost, mean_stats(rules, level + 1, lv, skill),
                            mean_stats(rules, level + 1, after, skill)))
            bank -= cost
            lv = after
    return Walk(rules, skill, rows, buys)


# ------------------------------------------------------------------- the new curve

SPREAD = (0.3, 2.5)     # an odds tier costs between these multiples of the ramp, whatever its odds
PRICE_WINDOW = 20       # runs averaged when measuring a tier's odds for its price


def ramp(j: int, total: int = sum(MAX_LEVEL)) -> float:
    """Wins of income the diagonal's j-th purchase costs on average: 5 for the first, 10 for the last."""
    return 5 + 5 * j / (total - 1)


def nice(x: float) -> int:
    step = 5 if x < 100 else 10 if x < 1000 else 50 if x < 10000 else 100
    return max(step, round(x / step) * step)


@dataclass
class Plan:
    upgrade: int
    tier: int
    cost: int
    run: int            # 1-based run the reference player first plays with it
    wins: float         # price in wins of the income earned while saving for it
    gain: float         # odds points over the next WINDOW runs; coins a win for the coin bonus
    before: Levels      # upgrade levels just before buying it
    rate: float         # wins of income per point of win odds (odds tiers)


def design(effects: Rules, skill: float = REFERENCE_SKILL) -> tuple[tuple[tuple[int, ...], ...], list[Plan]]:
    """Price every tier from what it buys the reference player on the diagonal.

    The player saves for one tier at a time, always the track furthest behind, so the start crowd
    gets two tiers for each strength and coin tier. Both odds upgrades cost the same wins of income
    per point of win odds at any stage, and that rate is set so the diagonal's odds purchases
    average ramp(j) wins. A coin tier costs its own extra coins over 5 x ramp(j) wins, so it pays
    for itself in 25 wins early and 50 late. Prices never fall from one tier to the next.
    """
    lv: Levels = (0, 0, 0)
    level = 0
    bank = 0.0
    costs: list[list[int]] = [[], [], []]
    plans: list[Plan] = []
    gain = [0.0, 0.0]
    for j in range(sum(MAX_LEVEL)):
        u = min((lv[i] / MAX_LEVEL[i], i) for i in range(3) if lv[i] < MAX_LEVEL[i])[1]
        k = ramp(j)
        here = mean_stats(effects, level, lv, skill, PRICE_WINDOW).p_win
        for i in (0, 1):
            if lv[i] < MAX_LEVEL[i]:   # a finished track keeps its last reading
                gain[i] = mean_stats(effects, level, bump(lv, i), skill, PRICE_WINDOW).p_win - here
        ref = (2 * gain[0] + gain[1]) / 3
        rate = k / (100 * ref) if ref > 0 else 0.0
        if u == 2:
            wins = 5 * k * (effects.mult[lv[2] + 1] / effects.mult[lv[2]] - 1)
        else:
            wins = min(SPREAD[1] * k, max(SPREAD[0] * k, k * gain[u] / ref)) if ref > 0 else k
        saving = max(1, round(wins))
        income = sum(stats(effects, i, lv, skill).per_win for i in range(level, level + saving)) / saving
        cost = nice(wins * income)
        if costs[u]:
            cost = max(cost, nice(costs[u][-1] * 1.05))
        costs[u].append(cost)
        while bank < cost:
            bank += stats(effects, level, lv, skill).per_win
            level += 1
        bank -= cost
        after = bump(lv, u)
        now, then = mean_stats(effects, level, lv, skill), mean_stats(effects, level, after, skill)
        shown = then.per_win - now.per_win if u == 2 else 100 * (then.p_win - now.p_win)
        plans.append(Plan(u, after[u], cost, level + 1, cost / income, shown, lv, rate))
        lv = after
    return tuple(tuple(c) for c in costs), plans


# ------------------------------------------------------------------- the Swift side

TIER_NAMES = ("startCrowdTiers", "memberPowerTiers", "coinMultiplierTiers")
TIER_RE = re.compile(r"Tier\(cost: (\d+), run: (\d+), gain: ([\d.]+)\)")


def swift_tiers(plans: list[Plan]) -> str:
    lines = []
    for u, name in enumerate(TIER_NAMES):
        lines.append(f"    static let {name}: [Tier] = [")
        lines += [f"        Tier(cost: {p.cost}, run: {p.run}, gain: {p.gain:.1f})," for p in plans if p.upgrade == u]
        lines.append("    ]")
    return "\n".join(lines) + "\n"


def baked_tiers() -> list[list[tuple[int, int, float]]]:
    """The tier tables in RunnerEconomy.swift."""
    text = ECONOMY_SWIFT.read_text()
    out = []
    for name in TIER_NAMES:
        block = re.search(rf"static let {name}: \[Tier\] = \[(.*?)\]", text, re.DOTALL)
        out.append([(int(c), int(r), float(g)) for c, r, g in TIER_RE.findall(block.group(1) if block else "")])
    return out


def planned_tiers(plans: list[Plan]) -> list[list[tuple[int, int, float]]]:
    return [[(p.cost, p.run, round(p.gain, 1)) for p in plans if p.upgrade == u] for u in range(3)]


def write_swift(plans: list[Plan]) -> None:
    text = ECONOMY_SWIFT.read_text()
    head, rest = text.split("    // BEGIN TIERS\n")
    _, tail = rest.split("    // END TIERS\n")
    ECONOMY_SWIFT.write_text(head + "    // BEGIN TIERS\n" + swift_tiers(plans) + "    // END TIERS\n" + tail)


# ------------------------------------------------------------------- checking the port

def describe(tr: Track) -> str:
    """One line per track, the same text the Swift dump prints."""
    def op(o: Op) -> str:
        return f"{o[0]}{o[1]}"

    def num(x: float) -> str:
        return f"{x:.17g}"

    parts = []
    for seg in tr.segments:
        if seg[0] == "gates":
            parts.append(f"g{num(seg[1])}:{op(seg[2])}|{op(seg[3])}")
        else:
            hz = seg[2]
            parts.append(f"o{num(seg[1])}:{hz[0]}(" + ",".join(num(v) for v in hz[1:]) + ")")
    kind = "boss" if tr.boss else "crowd"
    return f"{tr.level} {' '.join(parts)} {kind}{tr.strength} best{tr.best} z{num(tr.finale_z)} v{num(tr.speed)}"


FIGHT_RIVALS = (1, 7, 20, 29, 30, 31, 45, 60, 97, 151, 333, 1000, 2940)
FIGHT_CROWDS = tuple(range(1, 401)) + (512, 777, 1500, 3000, 5000, 12000)
COIN_LEVELS = (0, 7, 59, 299)

SWIFT_DUMP = r"""
import CoreGraphics
import Foundation

func num(_ x: Double) -> String { String(format: "%.17g", x) }
func op(_ o: GateOp) -> String {
    switch o {
    case .add(let n): return "+\(n)"
    case .subtract(let n): return "-\(n)"
    case .multiply(let n): return "x\(n)"
    case .divide(let n): return "/\(n)"
    }
}
for start in [5, 17, 45] {
    for level in 0..<300 {
        let t = RunnerGenerator.makeTrack(level: level, startCrowd: start)
        var parts: [String] = []
        for s in t.segments {
            switch s {
            case .gates(let p): parts.append("g\(num(p.z)):\(op(p.left))|\(op(p.right))")
            case .obstacle(let o):
                switch o.hazard {
                case .wall(let a, let b): parts.append("o\(num(o.z)):wall(\(num(a)),\(num(b)))")
                case .blade(let c, let h, let a, let v):
                    parts.append("o\(num(o.z)):blade(\(num(c)),\(num(h)),\(num(a)),\(num(v)))")
                case .spikes(let a, let b): parts.append("o\(num(o.z)):spikes(\(num(a)),\(num(b)))")
                }
            }
        }
        let fin: String
        switch t.finale {
        case .crowd(let n): fin = "crowd\(n)"
        case .boss(let hp): fin = "boss\(hp)"
        }
        print("track \(level) \(parts.joined(separator: " ")) \(fin) best\(t.bestPath) z\(num(t.finaleZ)) v\(num(t.speed))")
    }
}
for p in 0...10 {
    let power = RunnerEconomy(levels: ["memberPower": p]).memberPower
    for theirs in [RIVALS] {
        let row = [CROWDS].map { String(FinaleFight.survivors(mine: $0, theirs: theirs, power: power)) }
        print("fight \(p) \(theirs) \(row.joined(separator: ","))")
    }
}
for upgrade in RunnerEconomy.Upgrade.allCases {
    for level in 0...upgrade.maxLevel {
        let e = RunnerEconomy(levels: [upgrade.rawValue: level])
        print("effect \(upgrade.rawValue) \(level) \(e.startCrowd) \(num(e.memberPower)) \(num(e.coinMultiplier))")
    }
    for (n, t) in upgrade.tiers.enumerated() { print("tier \(upgrade.rawValue) \(n) \(t.cost) \(t.run) \(t.gain)") }
}
for c in 0...10 {
    let e = RunnerEconomy(levels: ["coinMultiplier": c])
    for level in [LEVELS] {
        print("coins \(c) \(level) " + (1...3).map { String(e.coins(level: level, stars: $0)) }.joined(separator: ","))
    }
}
"""


def swift_dump() -> list[str]:
    env = {**os.environ, "DEVELOPER_DIR": os.environ.get("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer")}
    source = (SWIFT_DUMP.replace("[RIVALS]", repr(list(FIGHT_RIVALS))).replace("[CROWDS]", repr(list(FIGHT_CROWDS)))
              .replace("[LEVELS]", repr(list(COIN_LEVELS))))
    with tempfile.TemporaryDirectory() as tmp:
        main = pathlib.Path(tmp) / "main.swift"
        main.write_text(source)
        exe = pathlib.Path(tmp) / "dump"
        files = ("SeededRNG.swift", "TrackModel.swift", "RunnerGenerator.swift", "RunnerEconomy.swift")
        built = subprocess.run(["xcrun", "swiftc", "-O", "-o", str(exe), *(str(RUNNER / f) for f in files), str(main)],
                               env=env, text=True, capture_output=True, check=False)
        if built.returncode:
            raise SystemExit(built.stderr)
        return subprocess.run([str(exe)], text=True, capture_output=True, check=True).stdout.splitlines()


def verify() -> None:
    """Compile the Swift generator, fight and economy, and compare everything this model relies on."""
    lines = swift_dump()
    got: dict[str, list[str]] = defaultdict(list)
    for line in lines:
        kind, rest = line.split(" ", 1)
        got[kind].append(rest)
    problems = []

    want = [describe(make_track(level, start)) for start in (5, 17, 45) for level in range(300)]
    bad = sum(a != b for a, b in zip(got["track"], want, strict=False)) + abs(len(got["track"]) - len(want))
    problems += [f"{bad} of {len(want)} tracks differ"] if bad else []
    print(f"tracks   {len(want) - bad}/{len(want)} match (start crowds 5, 17, 45; runs 1-300)")

    crowds = np.array(FIGHT_CROWDS)
    want = [f"{p} {t} " + ",".join(map(str, fight_many(crowds, t, NEW_EFFECTS.power[p], True).tolist()))
            for p in range(11) for t in FIGHT_RIVALS]
    bad = sum(a != b for a, b in zip(got["fight"], want, strict=False)) + abs(len(got["fight"]) - len(want))
    scalar = sum(fight(int(c), t, NEW_EFFECTS.power[p]) != int(s) for p in range(11) for t in FIGHT_RIVALS[::3]
                 for c, s in zip(crowds[::7], fight_many(crowds, t, NEW_EFFECTS.power[p], True)[::7], strict=True))
    problems += [f"{bad} fight rows differ"] if bad else []
    problems += [f"{scalar} scalar and array fights disagree"] if scalar else []
    print(f"fights   {len(want) - bad}/{len(want)} rows of {len(crowds)} crowds match, scalar port agrees: {scalar == 0}")

    want = []
    for u, name in enumerate(UPGRADES):
        for n in range(MAX_LEVEL[u] + 1):
            lv = [0, 0, 0]
            lv[u] = n
            want.append(f"{name} {n} {NEW_EFFECTS.start[lv[0]]} {NEW_EFFECTS.power[lv[1]]:.17g} {NEW_EFFECTS.mult[lv[2]]:.17g}")
    bad = sum(a != b for a, b in zip(got["effect"], want, strict=False)) + abs(len(got["effect"]) - len(want))
    problems += [f"{bad} effect values differ"] if bad else []
    want = [f"{c} {level} " + ",".join(str(v) for v in NEW_EFFECTS.coins(level, np.zeros(3, dtype=np.int64),
                                                                            np.array([1, 2, 3]), NEW_EFFECTS.mult[c]).tolist())
            for c in range(11) for level in COIN_LEVELS]
    bad_coins = sum(a != b for a, b in zip(got["coins"], want, strict=False)) + abs(len(got["coins"]) - len(want))
    problems += [f"{bad_coins} coin rows differ"] if bad_coins else []
    print(f"economy  effects match: {bad == 0}, coins match: {bad_coins == 0}")

    _, plans = design(NEW_EFFECTS)
    swift_tiers_seen = [[(int(c), int(r), float(g)) for name, _, c, r, g in (row.split() for row in got["tier"])
                         if name == u] for u in UPGRADES]
    same = swift_tiers_seen == planned_tiers(plans)
    problems += [] if same else ["RunnerEconomy.swift tiers differ from the model: run --write-swift"]
    print(f"prices   Swift tier tables match the model's curve: {same}")
    if problems:
        raise SystemExit("; ".join(problems))


# ------------------------------------------------------------------- the grid

def write_grid(new: Rules, path: pathlib.Path) -> int:
    """Every even start-crowd level x every strength level x coin levels 0/5/10, runs 1-60."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = 0
    with path.open("w", newline="") as fh:
        out = csv.writer(fh)
        out.writerow(["rules", "skill", "run", "start_lv", "power_lv", "coin_lv", "crowd", "power",
                      "p_win", "survivors", "coins_per_win", "coins_per_run", "coins_per_min"])
        for skill in SKILLS:
            for level in range(60):
                for s in range(0, 21, 2):
                    for rules in (OLD, new):
                        for p in range(11):
                            result = finale(level, rules.start[s], rules.power[p], skill, rules.rivals_grow, rules.carry)
                            for c in (0, 5, 10):
                                st = outcome_stats(rules, level, result, rules.mult[c])
                                out.writerow([rules.name, skill, level + 1, s, p, c, rules.start[s], rules.power[p],
                                              f"{st.p_win:.4f}", f"{st.survivors:.1f}", f"{st.per_win:.1f}",
                                              f"{st.per_run:.1f}", f"{st.per_minute:.1f}"])
                                rows += 1
                finale.cache_clear()
                arrival.cache_clear()
    return rows


# ------------------------------------------------------------------- the report

BANDS = ((1, 10), (11, 20), (21, 40), (41, 60))


def band(fn, first: int, last: int) -> float:
    return sum(fn(level) for level in range(first - 1, last)) / (last - first + 1)


def odds_table(rules: Rules, u: int, levels: list[int], skill: float) -> list[str]:
    out = []
    for n in levels:
        lv: Levels = (n, 0, 0) if u == 0 else (0, n, 0)
        cells = [band(lambda level, lv=lv: stats(rules, level, lv, skill).p_win, a, b) for a, b in BANDS]
        out.append(f"{n:3d}  " + "  ".join(f"{c:5.2f}" for c in cells))
    return out


def report(new: Rules, plans: list[Plan]) -> None:
    ref = REFERENCE_SKILL
    print("Skill = the chance of taking the better gate, and of dodging a hazard. A run takes 15 s.")
    print("Odds and coins are averaged over the next 10 runs; 'wins' prices a purchase in winning runs")
    print("of income, 'runs' in attempts (losses pay nothing).\n")

    print("1. Base upgrades: win odds, and what a win pays")
    print("   runs     skill .7   .8    .9   | old coins a win (.8) mean  max | new coins a win")
    for a, b in BANDS:
        odds = [band(lambda level, sk=sk: stats(OLD, level, (0, 0, 0), sk).p_win, a, b) for sk in SKILLS]
        old = [stats(OLD, level, (0, 0, 0), ref).per_win for level in range(a - 1, b)]
        fresh = band(lambda level: stats(new, level, (0, 0, 0), ref).per_win, a, b)
        print(f"   {a:2d}-{b:<3d}      " + "  ".join(f"{o:.2f}" for o in odds)
              + f"  | {statistics.mean(old):26.0f} {max(old):5.0f} | {fresh:8.0f}")

    print(f"\n2. Win odds from one upgrade alone (skill {ref}); columns are runs 1-10, 11-20, 21-40, 41-60")
    for u, levels in ((0, [0, 5, 10, 15, 20]), (1, list(range(11)))):
        print(f"   {NAMES[u]:<12s} old rules                    | new rules")
        for a_row, b_row in zip(odds_table(OLD, u, levels, ref), odds_table(new, u, levels, ref), strict=True):
            print(f"   {a_row}    | {b_row[5:]}")

    old_walk = walk(OLD, ref)
    print(f"\n3. Today's prices on the walk (skill {ref}, buys the cheapest the moment it can)")
    print("   run  upgrade        lv   cost   wins   runs   odds")
    for b in old_walk.buys:
        odds = "" if b.upgrade == 2 else f"{100 * b.odds:+5.1f}"
        print(f"   {b.run:3d}  {NAMES[b.upgrade]:<12s} {b.tier:4d} {b.cost:6d} {b.wins:6.2f} {b.runs:6.2f}  {odds}")
    cheap = [b for b in old_walk.buys if b.runs <= 2]
    print(f"   all {len(old_walk.buys)} bought by run {old_walk.buys[-1].run}; {len(cheap)} cost two runs of income or less, "
          f"{sum(b.wins <= 1 for b in old_walk.buys)} cost one win or less")

    print(f"\n4. The new curve (reference skill {ref}, on the diagonal). 'gain' is odds points over the next")
    print("   10 runs for crowd and strength, coins a win for the bonus; the skill .7 and .9 columns are the")
    print("   same purchase at the same run for those players.")
    print("   upgrade       lv    cost  run   wins    gain    .7     .9   wins/pt")
    for p in plans:
        others = []
        for sk in (0.7, 0.9):
            now, then = mean_stats(new, p.run - 1, p.before, sk), mean_stats(new, p.run - 1, bump(p.before, p.upgrade), sk)
            others.append(then.per_win - now.per_win if p.upgrade == 2 else 100 * (then.p_win - now.p_win))
        rate = "" if p.upgrade == 2 else f"{p.rate:5.2f}"
        print(f"   {NAMES[p.upgrade]:<12s} {p.tier:3d} {p.cost:7d} {p.run:4d} {p.wins:6.1f} {p.gain:7.1f} "
              f"{others[0]:6.1f} {others[1]:6.1f}   {rate}")
    for u in range(3):
        print(f"   {NAMES[u]:<12s} to max: {sum(new.costs[u]):7d} coins (old {sum(OLD.costs[u])})")

    print("\n5. The new prices on the walk, per skill (buys the cheapest the moment it can)")
    print("   skill  bought by run 60   all bought at run   price in wins: min  median  max   share 4-12")
    for sk in SKILLS:
        w = walk(new, sk, runs=420)
        wins = [b.wins for b in w.buys]
        by60 = sum(b.run <= 60 for b in w.buys)
        done = w.buys[-1].run if len(w.buys) == sum(MAX_LEVEL) else None
        share = sum(4 <= x <= 12 for x in wins) / len(wins)
        print(f"   {sk:4.1f}   {by60:16d}   {done if done else 'not by 420':>17}   {min(wins):16.1f} {statistics.median(wins):7.1f} "
              f"{max(wins):5.1f}   {share:9.0%}")

    print(f"\n6. Along the diagonal (crowd 2k, strength k, bonus k), skill {ref}: P(win) and coins a minute")
    print("   k   run 10 old     new     | run 30 old     new     | run 60 old     new")
    for k in (0, 2, 4, 6, 8, 10):
        lv = (2 * k, k, k)
        cells = []
        for level in (9, 29, 59):
            o, n = mean_stats(OLD, level, lv, ref, 5), mean_stats(new, level, lv, ref, 5)
            cells.append(f"{o.p_win:.2f} {o.per_minute:5.0f}  {n.p_win:.2f} {n.per_minute:5.0f}")
        print(f"   {k:2d}  " + " | ".join(cells))

    same = baked_tiers() == planned_tiers(plans)
    print(f"\n7. RunnerEconomy.swift tier tables {'match the model' if same else 'DIFFER from the model: run --write-swift'}")


def main() -> None:
    args = sys.argv[1:]
    if "--verify" in args:
        verify()
        return
    costs, plans = design(NEW_EFFECTS)
    new = replace(NEW_EFFECTS, costs=costs)
    if "--write-swift" in args:
        write_swift(plans)
        print(f"wrote {sum(len(c) for c in costs)} tiers into {ECONOMY_SWIFT.relative_to(ROOT)}")
    report(new, plans)
    if "--grid" in args:
        path = ROOT / "build/economy/grid.csv"
        rows = write_grid(new, path)
        print(f"\n{rows} rows in {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
