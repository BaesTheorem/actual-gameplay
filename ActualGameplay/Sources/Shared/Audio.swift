import AVFoundation
import Foundation
import QuartzCore

/// One-shot effects. The files live in `Audio/sfx/`; `Audio/CREDITS.txt` says where each one came from
/// and `Audio/sfx/make_synth.py` rebuilds them.
enum SoundEvent: CaseIterable {
    // The shell
    case tap, select, toggleOn, toggleOff, purchase
    // Save the Clawd
    case strokeLand, strokeRejected, strokeCut, heave, caught
    // Pull the Pin
    case pinPull, splash, sizzle, gemLand, cooked, melt
    // Crowd Run
    case gateGood, gateBad, pop, coin, hit, bossRoar
    // Every mode
    case win, lose

    /// One file per voice, taken in turn, so a sound that repeats is not the same sample every time.
    var files: [String] {
        switch self {
        case .tap: return ["ui_press.mp3"]
        case .select: return ["ui_select.mp3"]
        case .toggleOn: return ["ui_toggle_on.mp3"]
        case .toggleOff: return ["ui_toggle_off.mp3"]
        case .purchase: return ["ui_purchase.mp3"]
        case .strokeLand: return ["ink_land_1.wav", "ink_land_2.wav", "ink_land_3.wav"]
        case .strokeRejected: return ["ui_invalid_drop.mp3"]
        case .strokeCut: return ["saw_cut.wav"]
        case .heave: return ["heave.wav"]
        case .caught: return ["caught.wav"]
        case .pinPull: return ["pin_slide.wav"]
        case .splash: return ["splash.wav"]
        case .sizzle, .melt: return ["sizzle.wav"]
        case .gemLand: return ["gem_clink.wav"]
        case .cooked: return ["cooked.wav"]
        case .gateGood: return ["gate_good.wav"]
        case .gateBad: return ["gate_bad.wav"]
        case .pop: return ["pop_1.wav", "pop_2.wav"]
        case .coin: return ["coins.wav"]
        case .hit: return ["hit_1.wav", "hit_2.wav", "hit_3.wav"]
        case .bossRoar: return ["boss.wav"]
        case .win: return ["win.wav"]
        case .lose: return ["lose.wav"]
        }
    }

    /// The generated files are matched for loudness, so these volumes are the mix. Against the music at
    /// 0.35, taps and the busy sounds land about level with it, the moments that matter a few dB over its
    /// loud passages, and the results and the boss a little more.
    var volume: Float {
        switch self {
        case .tap: return 0.35
        case .select, .purchase: return 0.25
        case .toggleOn: return 0.2
        case .toggleOff: return 0.3
        case .strokeLand: return 0.5
        case .strokeRejected: return 0.65
        case .strokeCut: return 0.3
        case .heave: return 0.18
        case .caught: return 0.35
        case .pinPull, .splash, .sizzle, .gemLand: return 0.25
        case .melt: return 0.3
        // Mostly below what a phone speaker plays; on headphones it is a heavy thump.
        case .cooked: return 0.6
        case .gateGood, .gateBad: return 0.2
        case .pop: return 0.18
        case .coin: return 0.55
        case .hit: return 0.4
        case .bossRoar: return 0.45
        case .win: return 0.3
        case .lose: return 0.25
        }
    }

    /// The shortest gap between two plays. Anything sooner is dropped, so a storm of pops is a patter.
    var minGap: TimeInterval {
        switch self {
        case .hit: return 0.1
        case .coin, .bossRoar, .win, .lose: return 0.25
        default: return 0.04
        }
    }
}

/// Sounds that run until they are stopped: the swarm, the pen while ink flows, a spinning saw.
enum SoundLoop: CaseIterable {
    case buzz, scratch, saw

    var file: String {
        switch self {
        case .buzz: return "loop_buzz.wav"
        case .scratch: return "loop_scratch.wav"
        case .saw: return "loop_saw.wav"
        }
    }

    /// Volume at full level. `Audio.setLoopVolume` scales it, and all three sit under the music.
    var volume: Float {
        switch self {
        case .buzz: return 0.14
        case .scratch: return 0.12
        case .saw: return 0.08
        }
    }
}

/// Plays the effects. Everything is a no-op under `--silent` or with sound effects off in settings.
///
/// Each one-shot event gets up to three players, made as it first needs them and taken in turn, so a
/// sound that overlaps itself is not cut off. Each loop has one player that fades in and out. The
/// scenes start and stop their loops; `GameSceneBase` and the app stop them all whenever a level ends,
/// a scene goes away, or the app leaves the foreground.
enum Audio {
    /// Follows the settings toggle. Turning it off stops the loops.
    static var enabled = true {
        didSet { if !enabled { stopAllLoops() } }
    }

    static func play(_ event: SoundEvent) { SoundBank.shared.play(event) }

    /// Start a loop, or keep it going, at `volume` of its full level (0 to 1). Cheap enough for every frame.
    static func startLoop(_ loop: SoundLoop, volume: Float = 1) { SoundBank.shared.start(loop, level: volume) }

    /// Change a running loop's level (0 to 1). Does nothing if the loop is not running.
    static func setLoopVolume(_ loop: SoundLoop, _ volume: Float) { SoundBank.shared.setLevel(loop, volume) }

    static func stopLoop(_ loop: SoundLoop) { SoundBank.shared.stop(loop) }

    static func stopAllLoops() {
        for loop in SoundLoop.allCases { SoundBank.shared.stop(loop) }
    }

    /// The one session the music and the effects share: ambient, so the ring switch mutes the game
    /// and other audio keeps playing.
    static func prepareSession() {
        guard !sessionReady else { return }
        sessionReady = true
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
    }

    /// A file in `Audio/sfx/`, where the folder reference puts it in the bundle.
    static func url(for file: String) -> URL? {
        Bundle.main.url(forResource: file, withExtension: nil, subdirectory: "Audio/sfx")
    }

    private static var sessionReady = false
}

/// The players behind `Audio`. Main thread only, like the scenes that call it.
private final class SoundBank {
    static let shared = SoundBank()
    static let voices = 3

    private final class Loop {
        let player: AVAudioPlayer
        var running = false
        var level: Float = 0
        var stopping: DispatchWorkItem?

        init(player: AVAudioPlayer) { self.player = player }
    }

    private let silent = LaunchArguments.silent
    private var players: [SoundEvent: [AVAudioPlayer]] = [:]
    private var turn: [SoundEvent: Int] = [:]
    private var lastPlayed: [SoundEvent: CFTimeInterval] = [:]
    private var broken = Set<String>()
    private var loops: [SoundLoop: Loop] = [:]

    private var live: Bool { Audio.enabled && !silent }

    func play(_ event: SoundEvent) {
        guard live else { return }
        let now = CACurrentMediaTime()
        if let last = lastPlayed[event], now - last < event.minGap { return }
        lastPlayed[event] = now
        let index = ((turn[event] ?? -1) + 1) % SoundBank.voices
        turn[event] = index
        guard let player = voice(index, of: event) else { return }
        player.volume = event.volume
        player.currentTime = 0
        player.play()
    }

    /// Voice `index` of an event, made the first time it is needed. Voice n plays file n, wrapping.
    private func voice(_ index: Int, of event: SoundEvent) -> AVAudioPlayer? {
        var pool = players[event] ?? []
        if index < pool.count { return pool[index] }
        let files = event.files
        guard !files.isEmpty, let player = makePlayer(files[pool.count % files.count]) else { return pool.first }
        pool.append(player)
        players[event] = pool
        return player
    }

    private func makePlayer(_ file: String) -> AVAudioPlayer? {
        guard !broken.contains(file) else { return nil }
        Audio.prepareSession()
        guard let url = Audio.url(for: file), let player = try? AVAudioPlayer(contentsOf: url) else {
            broken.insert(file)
            return nil
        }
        player.prepareToPlay()
        return player
    }

    func start(_ loop: SoundLoop, level: Float) {
        guard live, let voice = loopVoice(loop) else { return }
        voice.stopping?.cancel()
        voice.stopping = nil
        let level = min(1, max(0, level))
        if voice.running, voice.player.isPlaying {
            setLevel(voice, loop, level)
            return
        }
        voice.running = true
        voice.level = level
        if !voice.player.isPlaying {
            voice.player.volume = 0
            voice.player.play()
        }
        voice.player.setVolume(loop.volume * level, fadeDuration: 0.1)
    }

    func setLevel(_ loop: SoundLoop, _ level: Float) {
        guard let voice = loops[loop], voice.running else { return }
        setLevel(voice, loop, min(1, max(0, level)))
    }

    private func setLevel(_ voice: Loop, _ loop: SoundLoop, _ level: Float) {
        guard abs(level - voice.level) >= 0.02 || (level == 0 && voice.level != 0) else { return }
        voice.level = level
        voice.player.setVolume(loop.volume * level, fadeDuration: 0.08)
    }

    /// Fade out, then pause at the top of the file so the next start begins cleanly.
    func stop(_ loop: SoundLoop) {
        guard let voice = loops[loop], voice.running else { return }
        voice.running = false
        voice.player.setVolume(0, fadeDuration: 0.1)
        let work = DispatchWorkItem { [weak voice] in
            guard let voice, !voice.running else { return }
            voice.player.pause()
            voice.player.currentTime = 0
        }
        voice.stopping = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    private func loopVoice(_ loop: SoundLoop) -> Loop? {
        if let voice = loops[loop] { return voice }
        guard let player = makePlayer(loop.file) else { return nil }
        player.numberOfLoops = -1
        let voice = Loop(player: player)
        loops[loop] = voice
        return voice
    }
}

/// The soundtrack: Kevin MacLeod (incompetech.com), Creative Commons BY 4.0. Files live in
/// `Audio/` next to `CREDITS.txt`, named exactly as the track titles.
enum MusicTrack: String, CaseIterable {
    case menu = "Wallpaper"
    case saveDog = "Pixelland"
    case pinPull = "Investigations"
    case runner = "Digital Lemonade"

    var title: String { rawValue }
}

extension GameMode {
    var track: MusicTrack {
        switch self {
        case .saveDog: return .saveDog
        case .pinPull: return .pinPull
        case .runner: return .runner
        }
    }
}

/// One looping track at a time, with a short crossfade between them. Ambient category, so the
/// ring switch mutes it and other audio keeps playing.
final class MusicPlayer {
    static let shared = MusicPlayer()
    static let volume: Float = 0.35

    var enabled = true {
        didSet {
            guard enabled != oldValue else { return }
            if enabled, let current { start(current) } else { stop() }
        }
    }

    private var player: AVAudioPlayer?
    private var current: MusicTrack?

    func play(_ track: MusicTrack) {
        current = track
        guard enabled else { return }
        if let player, player.url?.deletingPathExtension().lastPathComponent == track.rawValue {
            if !player.isPlaying { player.play() }
            return
        }
        start(track)
    }

    func pause() { player?.pause() }

    func resume() {
        guard enabled else { return }
        player?.play()
    }

    private func start(_ track: MusicTrack) {
        Audio.prepareSession()
        guard let url = Bundle.main.url(forResource: track.rawValue, withExtension: "mp3", subdirectory: "Audio"),
              let next = try? AVAudioPlayer(contentsOf: url) else { return }
        let previous = player
        previous?.setVolume(0, fadeDuration: 0.4)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { previous?.stop() }
        next.numberOfLoops = -1
        next.volume = 0
        next.prepareToPlay()
        next.play()
        next.setVolume(MusicPlayer.volume, fadeDuration: 0.8)
        player = next
    }

    private func stop() {
        let previous = player
        player = nil
        previous?.setVolume(0, fadeDuration: 0.3)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { previous?.stop() }
    }
}
