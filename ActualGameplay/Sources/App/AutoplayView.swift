import Combine
import SpriteKit
import SwiftUI

/// One thing to try: a level, and optionally a variation on how to play it.
struct AuditTrial: Decodable {
    struct Transform: Decodable {
        var dx: CGFloat
        var dy: CGFloat
        var scale: CGFloat
    }

    var id: String
    var level: Int
    var pins: [String]?
    var transform: Transform?
    var strokes: [[[CGFloat]]]?
    var policy: String?
}

/// What scripts/audit.py writes into the app's container before launching with --audit.
struct AuditPlan: Decodable {
    var mode: String
    var trials: [AuditTrial]

    static var fileURL: URL {
        ProgressStore.shared.fileURL.deletingLastPathComponent().appendingPathComponent("audit-plan.json")
    }

    static func load() -> AuditPlan? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(AuditPlan.self, from: data)
    }
}

/// Plays levels back to back without a human and records what happened. With no plan it replays
/// every stored solution (the regression suite for level content); with a plan from the audit
/// script it runs whatever variations the plan asks for.
final class AutoplayRunner: ObservableObject {
    struct Entry: Codable, Identifiable {
        var id: String
        var name: String
        var outcome: String
        var seconds: Double
        var stars: Int
        var detail: String
        var passed: Bool { outcome == "won" }
    }

    private struct Trial {
        let id: String
        let level: Int
        let audit: AuditTrial?
    }

    let mode: GameMode
    let plan: AuditPlan?
    @Published private(set) var entries: [Entry] = []
    @Published private(set) var current = 0
    @Published private(set) var finished = false
    @Published private(set) var session: GameSession?

    private let catalog = LevelCatalog.shared
    private let trials: [Trial]
    private var startedAt = Date()
    private var timer: Timer?
    private var phaseWatch: AnyCancellable?
    private var completed = false

    var count: Int { trials.count }
    var passedCount: Int { entries.filter(\.passed).count }

    static var resultsDirectory: URL {
        ProgressStore.shared.fileURL.deletingLastPathComponent().appendingPathComponent("replay", isDirectory: true)
    }

    init(mode: GameMode, only: Set<String>? = nil, plan: AuditPlan? = nil) {
        self.mode = mode
        self.plan = plan
        if let plan {
            trials = plan.trials.map { Trial(id: $0.id, level: $0.level, audit: $0) }
        } else {
            let catalog = LevelCatalog.shared
            let total = mode == .runner ? RunnerGenerator.replayLevels : catalog.count(for: mode)
            trials = (0..<total).compactMap { index -> Trial? in
                let id = mode == .runner ? String(format: "%02d", index + 1) : catalog.id(for: mode, index: index)
                if let only, !only.contains(id) { return nil }
                return Trial(id: id, level: index, audit: nil)
            }
        }
    }

    func start() {
        guard session == nil, !finished, entries.isEmpty else { return }
        run(position: 0)
    }

    private func run(position: Int) {
        guard position < trials.count else {
            finish()
            return
        }
        let trial = trials[position]
        current = position
        completed = false
        guard let scene = SceneFactory.makeLevelScene(mode: mode, index: trial.level) else {
            entries.append(Entry(id: trial.id, name: "?", outcome: "error", seconds: 0, stars: 0, detail: "could not load level"))
            run(position: position + 1)
            return
        }
        configure(scene, for: trial)
        let newSession = GameSession(mode: mode, scene: scene)
        session = newSession
        startedAt = Date()
        let timeout = scene.replayWait + 2
        phaseWatch = newSession.$phase.sink { [weak self] phase in
            if phase.isOver { self?.complete(scene: scene, trial: trial, position: position, phase: phase) }
        }
        timer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            self?.complete(scene: scene, trial: trial, position: position, phase: nil)
        }
    }

    /// Apply a trial's variation, or fall back to the stored solution.
    private func configure(_ scene: GameSceneBase & ReplayableScene, for trial: Trial) {
        guard let audit = trial.audit else {
            scene.startReplay()
            return
        }
        switch scene {
        case let pin as PinScene:
            pin.replay(pins: audit.pins ?? [])
        case let draw as DrawScene:
            if let strokes = audit.strokes {
                draw.replay(strokes: strokes.map { $0.map { CGPoint(x: $0[0], y: $0[1]) } })
            } else if let solution = draw.level.solution {
                let t = audit.transform.map { StrokeTransform(dx: $0.dx, dy: $0.dy, scale: $0.scale) } ?? .identity
                draw.replay(solution, transform: t)
            }
        case let runner as RunnerScene:
            runner.configure(policy: audit.policy.flatMap(RunnerScene.SteerPolicy.init(rawValue:)) ?? .greedy)
        default:
            scene.startReplay()
        }
    }

    private func complete(scene: GameSceneBase & ReplayableScene, trial: Trial, position: Int, phase: GamePhase?) {
        guard !completed else { return }
        completed = true
        timer?.invalidate()
        timer = nil
        phaseWatch = nil
        let seconds = Date().timeIntervalSince(startedAt)
        var outcome = "timeout"
        var stars = 0
        var detail = "no result before timeout"
        if case .won(let s, _, let score)? = phase {
            outcome = "won"
            stars = s
            detail = scene.describe(score: score)
        } else if case .lost(let reason)? = phase {
            outcome = "lost"
            detail = reason
        }
        if trial.audit == nil, !scene.hasSolution {
            outcome = "no-solution"
            detail = "level has no stored solution"
        }
        if let image = scene.snapshot() {
            let safe = trial.id.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." ? $0 : "_" }
            save(image, name: "\(mode.rawValue)-\(String(safe)).png")
        }
        entries.append(Entry(id: trial.id, name: scene.levelName, outcome: outcome,
                             seconds: (seconds * 100).rounded() / 100, stars: stars, detail: detail))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.run(position: position + 1)
        }
    }

    private func finish() {
        finished = true
        session = nil
        let dir = AutoplayRunner.resultsDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let name = plan == nil ? "\(mode.rawValue).json" : "audit-\(mode.rawValue).json"
        if let data = try? encoder.encode(entries) {
            try? data.write(to: dir.appendingPathComponent(name), options: .atomic)
        }
    }

    private func save(_ image: UIImage, name: String) {
        let dir = AutoplayRunner.resultsDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? image.pngData()?.write(to: dir.appendingPathComponent(name), options: .atomic)
    }
}

struct AutoplayView: View {
    @StateObject private var runner: AutoplayRunner
    @Environment(\.dismiss) private var dismiss

    init(mode: GameMode, only: Set<String>? = nil, plan: AuditPlan? = nil) {
        _runner = StateObject(wrappedValue: AutoplayRunner(mode: mode, only: only, plan: plan))
    }

    var body: some View {
        ZStack {
            Theme.surface.ignoresSafeArea()
            if let session = runner.session, !runner.finished {
                SpriteView(scene: session.scene, preferredFramesPerSecond: 60)
                    .ignoresSafeArea()
                    .id(runner.current)
                VStack {
                    HStack(spacing: 12) {
                        IconButton(icon: .close) { dismiss() }
                        Text("\(runner.plan == nil ? "AUTOPLAY" : "AUDIT") \(runner.current + 1)/\(runner.count)")
                            .font(Theme.mono(13))
                            .foregroundStyle(Theme.onSurface)
                        Spacer()
                    }
                    .padding(12)
                    Spacer()
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text(runner.plan == nil ? "AUTOPLAY" : "AUDIT").font(Theme.title(24))
                        Spacer()
                        IconButton(icon: .close) { dismiss() }
                    }
                    Text("\(runner.passedCount)/\(runner.entries.count) won")
                        .font(Theme.mono(14))
                        .foregroundStyle(runner.passedCount == runner.entries.count ? Theme.runner : Theme.danger)
                    ScrollView {
                        VStack(spacing: 6) {
                            ForEach(runner.entries) { entry in
                                HStack(spacing: 8) {
                                    Text(entry.id).font(Theme.mono(12)).lineLimit(1)
                                    Spacer()
                                    Text(entry.outcome).font(Theme.mono(12))
                                        .foregroundStyle(entry.passed ? Theme.runner : Theme.danger)
                                    Text(String(format: "%.1fs", entry.seconds)).font(Theme.mono(12))
                                        .foregroundStyle(Theme.onSurfaceMuted)
                                }
                                .padding(8)
                                .overlay(Rectangle().stroke(Theme.outline, lineWidth: 1))
                            }
                        }
                    }
                }
                .padding(20)
                .foregroundStyle(Theme.onSurface)
            }
        }
        .statusBarHidden(true)
        .onAppear { runner.start() }
    }
}
