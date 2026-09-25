#!/usr/bin/env python3
"""Make the game's sound effects.

With no arguments this regenerates the synthesized set (the bee buzz, the ink scratch and the saw
whir loops, and the splash, sizzle and heave), which needs only numpy. With --fetch it also
downloads the Kenney packs and the UI SFX organic pack (all CC0) and rebuilds the picks taken from
them, which needs ffmpeg. ../CREDITS.txt lists every file and where it came from.

Everything written here is 16-bit 44.1 kHz mono WAV, trimmed, faded, and matched for loudness
(A-weighted RMS of the loudest 100 ms, under a -1 dBFS peak), so the volumes in Audio.swift are the
whole mix. The UI SFX MP3s are copied as they ship. The loops are built periodic: every frequency
and every wobble runs a whole number of cycles per loop and the noise is filtered on a ring, so
the last sample leads into the first with no click and no crossfade. Seeds are fixed, so a rerun
writes the same files.
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import tempfile
import urllib.request
import wave
import zipfile

import numpy as np

SR = 44100
OUT = pathlib.Path(__file__).resolve().parents[2] / "ActualGameplay/Audio/sfx"   # the script lives in tools/ so it never ships in the app
LOUDNESS = -14.0
CEILING = -1.0

KENNEY = {
    "impact-sounds": "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
    "interface-sounds": "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip",
    "digital-audio": "https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip",
    "rpg-audio": "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip",
}

# Written file: (Kenney pack, file in its Audio folder, longest kept in seconds, fade-out in seconds).
PICKS = {
    "ink_land_1.wav": ("impact-sounds", "impactWood_light_000.ogg", 0.20, 0.05),
    "ink_land_2.wav": ("impact-sounds", "impactWood_light_002.ogg", 0.20, 0.05),
    "ink_land_3.wav": ("impact-sounds", "impactWood_light_004.ogg", 0.20, 0.05),
    "saw_cut.wav": ("rpg-audio", "chop.ogg", 0.25, 0.05),
    "caught.wav": ("interface-sounds", "error_001.ogg", 0.20, 0.03),
    "pin_slide.wav": ("rpg-audio", "drawKnife2.ogg", 0.40, 0.08),
    "gem_clink.wav": ("impact-sounds", "impactGlass_light_001.ogg", 0.25, 0.06),
    "cooked.wav": ("impact-sounds", "impactSoft_heavy_002.ogg", 0.50, 0.12),
    "gate_good.wav": ("digital-audio", "pepSound3.ogg", 0.45, 0.06),
    "gate_bad.wav": ("digital-audio", "pepSound1.ogg", 0.45, 0.06),
    "pop_1.wav": ("interface-sounds", "drop_002.ogg", 0.15, 0.04),
    "pop_2.wav": ("interface-sounds", "drop_003.ogg", 0.15, 0.04),
    "coins.wav": ("rpg-audio", "handleCoins.ogg", 0.60, 0.10),
    "hit_1.wav": ("impact-sounds", "impactPunch_medium_000.ogg", 0.35, 0.08),
    "hit_2.wav": ("impact-sounds", "impactPunch_medium_001.ogg", 0.35, 0.08),
    "hit_3.wav": ("impact-sounds", "impactPunch_medium_003.ogg", 0.35, 0.08),
    "boss.wav": ("impact-sounds", "impactBell_heavy_001.ogg", 1.20, 0.35),
    "win.wav": ("interface-sounds", "confirmation_004.ogg", 0.55, 0.06),
    "lose.wav": ("digital-audio", "phaserDown3.ogg", 0.55, 0.08),
}

UISFX = "https://cdn.jsdelivr.net/npm/uisfx@0.4.0/sounds/organic/{}.mp3"
UI_PICKS = {
    "ui_press.mp3": "press",
    "ui_select.mp3": "select",
    "ui_toggle_on.mp3": "toggle-on",
    "ui_toggle_off.mp3": "toggle-off",
    "ui_purchase.mp3": "purchase",
    "ui_invalid_drop.mp3": "invalid-drop",
}


# MARK: - Levels and files

def a_weight(freqs: np.ndarray) -> np.ndarray:
    f2 = np.maximum(freqs, 1e-3) ** 2
    ra = (12194.0 ** 2 * f2 ** 2) / (
        (f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194.0 ** 2))
    return ra * 10 ** (2.0 / 20)


def loudness(x: np.ndarray) -> float:
    """A-weighted RMS of the loudest 100 ms, in dBFS."""
    padded = np.concatenate([x, np.zeros(8192)])
    spec = np.fft.rfft(padded) * a_weight(np.fft.rfftfreq(len(padded), 1 / SR))
    weighted = np.fft.irfft(spec, len(padded))[: len(x)]
    w = min(len(weighted), int(0.1 * SR))
    sums = np.concatenate([[0.0], np.cumsum(weighted ** 2)])
    return 10 * np.log10(max(float(np.max(sums[w:] - sums[:-w]) / w), 1e-20))


def peak_db(x: np.ndarray) -> float:
    return 20 * np.log10(max(float(np.max(np.abs(x))), 1e-9))


def limit(x: np.ndarray, ceiling: float) -> np.ndarray:
    """Hold peaks at `ceiling` (linear): gain drops ahead of a peak over 2 ms and recovers over 40 ms."""
    need = np.minimum(1.0, ceiling / np.maximum(np.abs(x), 1e-9))
    ahead = int(0.002 * SR)
    padded = np.concatenate([need, np.ones(ahead)])
    held = np.array([padded[i:i + ahead + 1].min() for i in range(len(x))])
    gain = np.empty_like(held)
    g = 1.0
    back = np.exp(-1 / (0.04 * SR))
    for i, h in enumerate(held):
        g = h if h < g else h + (g - h) * back
        gain[i] = g
    smooth = np.convolve(gain, np.ones(ahead) / ahead, mode="same")
    return x * np.minimum(gain, smooth)


def level(x: np.ndarray) -> np.ndarray:
    """Bring a sound to the shared loudness. Peaks past the ceiling are limited, by 6 dB at most, so a
    knock with one sharp spike is not left far quieter than everything else."""
    gain = min(LOUDNESS - loudness(x), CEILING + 6 - peak_db(x))
    y = x * 10 ** (gain / 20)
    y = limit(y, 10 ** ((CEILING - 0.1) / 20))
    return y * min(1.0, 10 ** (CEILING / 20) / max(float(np.max(np.abs(y))), 1e-9))


def fade(x: np.ndarray, seconds: float, start: float = 0.001) -> np.ndarray:
    x = x.copy()
    n = min(len(x), int(seconds * SR))
    if n:
        x[-n:] *= np.cos(np.linspace(0, np.pi / 2, n)) ** 2
    m = min(len(x), int(start * SR))
    if m:
        x[:m] *= np.linspace(0, 1, m)
    return x


def write(name: str, x: np.ndarray) -> None:
    pcm = np.round(np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(OUT / name), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


# MARK: - Filters

def band(x: np.ndarray, lo: float | None, hi: float | None, ring: bool = False) -> np.ndarray:
    """Two-pole-style band limit in the frequency domain. On a ring for loops, zero-padded otherwise."""
    y = x if ring else np.concatenate([x, np.zeros(8192)])
    freqs = np.maximum(np.fft.rfftfreq(len(y), 1 / SR), 1e-3)
    gain = np.ones_like(freqs)
    if lo:
        gain /= np.sqrt(1 + (lo / freqs) ** 4)
    if hi:
        gain /= np.sqrt(1 + (freqs / hi) ** 4)
    return np.fft.irfft(np.fft.rfft(y) * gain, len(y))[: len(x)]


def moving(x: np.ndarray, gains) -> np.ndarray:
    """Filter that changes over time: `gains(t, freqs)` gives the response for a frame centred at t."""
    size, hop = 1024, 256
    window = np.hanning(size)
    padded = np.concatenate([np.zeros(size), x, np.zeros(size)])
    out = np.zeros_like(padded)
    norm = np.zeros_like(padded)
    freqs = np.fft.rfftfreq(size, 1 / SR)
    for start in range(0, len(padded) - size, hop):
        t = (start + size / 2 - size) / SR
        frame = np.fft.rfft(padded[start:start + size] * window) * gains(max(t, 0.0), freqs)
        out[start:start + size] += np.fft.irfft(frame, size) * window
        norm[start:start + size] += window ** 2
    return (out / np.maximum(norm, 1e-6))[size:size + len(x)]


def saw(phase: np.ndarray, f0: float, top: float, cutoff: float) -> np.ndarray:
    """Band-limited sawtooth from a running phase, harmonics rolled off above `cutoff`."""
    out = np.zeros_like(phase)
    for k in range(1, int(top / f0) + 1):
        out += np.sin(k * phase) / k / np.sqrt(1 + (k * f0 / cutoff) ** 4)
    return out


# MARK: - Synthesized sounds

def buzz() -> np.ndarray:
    """A small swarm: four sawtooth voices near 190 Hz, each with its own slow pitch and level wobble.
    2 s loop: every rate below is a multiple of 0.5 Hz."""
    n = 2 * SR
    t = np.arange(n) / SR
    rng = np.random.default_rng(1)
    out = np.zeros(n)
    # f0, pitch wobble rate and depth, level wobble rate and depth
    for f0, fm, depth, fa, am in [(187.0, 0.5, 0.030, 1.5, 0.30), (191.5, 1.0, 0.025, 3.0, 0.25),
                                  (196.0, 1.5, 0.035, 0.5, 0.35), (202.5, 2.5, 0.020, 5.5, 0.20)]:
        p1, p2 = rng.uniform(0, 2 * np.pi, 2)
        phase = 2 * np.pi * f0 * t - (f0 * depth / fm) * (np.cos(2 * np.pi * fm * t + p1) - np.cos(p1))
        out += saw(phase, f0 * (1 + depth), 9000, 2200) * (1 + am * np.sin(2 * np.pi * fa * t + p2))
    wings = band(rng.standard_normal(n), 300, 3000, ring=True)
    out += wings / np.std(wings) * np.std(out) * 0.08
    # A phone speaker hardly plays 190 Hz; lean on the harmonics it does play.
    return level(band(out, 320, None, ring=True))


def scratch() -> np.ndarray:
    """Pen on paper: a faint hiss with fine and coarse grains of brighter noise on top. 1.2 s loop,
    grains wrap around the end."""
    n = int(1.2 * SR)
    rng = np.random.default_rng(2)

    def grains(count: int, shortest: float, longest: float) -> np.ndarray:
        out = np.zeros(n)
        for _ in range(count):
            length = int(rng.uniform(shortest, longest) * SR)
            idx = (rng.integers(0, n) + np.arange(length)) % n
            out[idx] += rng.standard_normal(length) * np.hanning(length) * rng.uniform(0.3, 1.0)
        return out

    fine = band(grains(130, 0.002, 0.006), 2500, 6000, ring=True)
    coarse = band(grains(26, 0.010, 0.025), 1000, 3000, ring=True)
    bed = band(rng.standard_normal(n), 1200, 5000, ring=True)
    t = np.arange(n) / SR
    pressure = 1 + 0.2 * np.sin(2 * np.pi * t / 1.2 * 2) + 0.1 * np.sin(2 * np.pi * t / 1.2 * 5 + 1)
    out = (fine / np.std(fine) + 0.8 * coarse / np.std(coarse) + 0.35 * bed / np.std(bed)) * pressure
    return level(out)


def saw_whir() -> np.ndarray:
    """A spinning blade: a metallic whine and a low buzz pulsing at the tooth rate, over a little air.
    1 s loop, every frequency a whole number of hertz."""
    n = SR
    t = np.arange(n) / SR
    rng = np.random.default_rng(6)
    teeth = 0.5 + 0.5 * np.sin(2 * np.pi * 12 * t)
    whine = np.sin(2 * np.pi * 1150 * t) + 0.35 * np.sin(2 * np.pi * 2311 * t) + 0.12 * np.sin(2 * np.pi * 3467 * t)
    low = saw(2 * np.pi * 140 * t, 140, 6000, 1200)
    air = band(rng.standard_normal(n), 800, 3000, ring=True)
    out = (0.25 * whine * (0.55 + 0.45 * teeth) + 0.3 * low / np.std(low) * (0.7 + 0.3 * teeth)
           + 0.1 * air / np.std(air) * (0.6 + 0.4 * teeth))
    return level(band(out, 250, None, ring=True))


def splash() -> np.ndarray:
    """Water landing: a noise burst that loses its brightness, a soft thump and a bubble under it,
    and a few droplets after. 0.55 s."""
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(3)
    burst = rng.standard_normal(n) * (1 - np.exp(-t / 0.004)) * np.exp(-t / 0.16)
    burst = moving(burst, lambda at, f: 1 / np.sqrt(1 + (f / (700 + 8300 * np.exp(-at / 0.09))) ** 4))
    out = burst / np.std(burst[: int(0.1 * SR)])
    thump = (np.sin(2 * np.pi * (90 * t + 80 * 0.03 * (1 - np.exp(-t / 0.03))))
             * (1 - np.exp(-t / 0.002)) * np.exp(-t / 0.05))
    out += 1.2 * thump
    bubble_t = np.clip(t - 0.006, 0, None)
    bubble = np.sin(2 * np.pi * (380 * bubble_t + 380 * 0.04 * (np.exp(bubble_t / 0.04) - 1) * 0.5))
    out += 0.6 * bubble * (t > 0.006) * np.exp(-bubble_t / 0.035)
    for i in range(5):
        at = rng.uniform(0.08, 0.40)
        f0 = rng.uniform(1100, 2300)
        d = np.clip(t - at, 0, None)
        drop = (np.sin(2 * np.pi * (f0 * d + f0 * 0.5 * d ** 2 / 0.05))
                * (t > at) * np.exp(-d / rng.uniform(0.02, 0.035)))
        out += drop * rng.uniform(0.25, 0.45) * (1 - 0.12 * i)
    return fade(level(out), 0.08)


def sizzle() -> np.ndarray:
    """Water on lava: a steam hiss that dies away slowly, with frying crackle on top. 0.9 s."""
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(4)
    hiss = band(rng.standard_normal(n), 1800, 7000)
    flutter = band(rng.standard_normal(n), None, 30)
    flutter = 1 + 0.35 * flutter / np.max(np.abs(flutter))
    hiss *= (1 - np.exp(-t / 0.015)) * np.exp(-t / 0.3) * flutter
    crackle = np.zeros(n)
    rate = 220 * np.exp(-t / 0.3)
    for i in np.nonzero(rng.random(n) < rate / SR)[0]:
        length = int(rng.uniform(0.0008, 0.003) * SR)
        seg = rng.standard_normal(length) * np.hanning(length) * rng.uniform(0.3, 1.0)
        crackle[i:i + length] += seg[: n - i]
    crackle = band(crackle, 2500, 8000)
    out = hiss / np.std(hiss[: int(0.2 * SR)]) + 0.9 * crackle / max(np.std(crackle[: int(0.2 * SR)]), 1e-9)
    return fade(level(out), 0.15)


def heave() -> np.ndarray:
    """The crew's shove: a band of air that sweeps up and back down. 0.55 s."""
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(5)
    rise, total = 0.3, 0.55
    swell = np.where(t < rise, np.sin(np.pi / 2 * t / rise) ** 2, np.cos(np.pi / 2 * (t - rise) / (total - rise)) ** 2)

    def centre(at: float) -> float:
        if at < rise:
            return 250 * (1300 / 250) ** (at / rise)
        return 1300 * (450 / 1300) ** min(1.0, (at - rise) / (total - rise))

    air = moving(rng.standard_normal(n),
                 lambda at, f: np.exp(-0.5 * (np.log2(np.maximum(f, 1) / centre(at)) / 0.6) ** 2))
    return fade(level(air * swell), 0.03, start=0.005)


SYNTH = {
    "loop_buzz.wav": buzz,
    "loop_scratch.wav": scratch,
    "loop_saw.wav": saw_whir,
    "splash.wav": splash,
    "sizzle.wav": sizzle,
    "heave.wav": heave,
}


# MARK: - Picks from the packs

def download(url: str, to: pathlib.Path) -> pathlib.Path:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        to.write_bytes(response.read())
    return to


def decode(path: pathlib.Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def trim(x: np.ndarray, longest: float, tail: float) -> np.ndarray:
    """Cut the silence off both ends (40 dB under the peak), cap the length, fade the end."""
    loud = np.nonzero(np.abs(x) > np.max(np.abs(x)) * 10 ** (-40 / 20))[0]
    x = x[max(0, loud[0] - int(0.002 * SR)):loud[-1] + 1][: int(longest * SR)]
    return fade(x, min(tail, len(x) / SR / 2))


def fetch() -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("--fetch needs ffmpeg to decode the Kenney .ogg files")
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        for pack, url in KENNEY.items():
            with zipfile.ZipFile(download(url, root / f"{pack}.zip")) as z:
                z.extractall(root / pack)
        for name, (pack, source, longest, tail) in PICKS.items():
            write(name, level(trim(decode(root / pack / "Audio" / source), longest, tail)))
        for name, cue in UI_PICKS.items():
            download(UISFX.format(cue), OUT / name)


def report() -> None:
    total = 0
    for path in sorted(OUT.glob("*.wav")) + sorted(OUT.glob("*.mp3")):
        size = path.stat().st_size
        total += size
        if path.suffix == ".wav":
            with wave.open(str(path)) as f:
                x = np.frombuffer(f.readframes(f.getnframes()), dtype="<i2") / 32767
            print(f"{path.name:22s} {len(x) / SR:5.2f}s  peak {peak_db(x):5.1f}  "
                  f"loud {loudness(x):5.1f}  {size / 1024:6.1f} KB")
        else:
            print(f"{path.name:22s}  (mp3 as shipped)                  {size / 1024:6.1f} KB")
    print(f"{'total':22s} {total / 1024:.0f} KB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--fetch", action="store_true",
                        help="also rebuild the Kenney and UI SFX picks (network, ffmpeg)")
    args = parser.parse_args()
    for name, make in SYNTH.items():
        write(name, make())
    if args.fetch:
        fetch()
    report()


if __name__ == "__main__":
    main()
