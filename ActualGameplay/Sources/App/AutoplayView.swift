import Combine
import SpriteKit
import SwiftUI

/// Plays every level's stored solution back to back and records the outcome. This is the
/// regression suite for level content: run it after touching physics or a level file.
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

    let mode: GameMode
    let only: Set<String>?
    @Published private(set) var entries: [Entry] = []
    @Published private(set) var current = 0
    @Published private(set) var finished = false
    @Published private(set) var session: GameSession?

    private let catalog = LevelCatalog.shared
    private var startedAt = Date()
    private var timer: Timer?
    private var phaseWatch: AnyCancellable?
    private var completed = false

    /// Indices to play: every level, or just the ids named by `only`.
    private(set) lazy var indices: [Int] = {
        let all = Array(0..<catalog.count(for: mode))
        guard let only else { return all }
        return all.filter { only.contains(catalog.id(for: mode, index: $0)) }
    }()
    var count: Int { indices.count }
    var passedCount: Int { entries.filter(\.passed).count }

    static var resultsDirectory: URL {
        ProgressStore.shared.fileURL.deletingLastPathComponent().appendingPathComponent("replay", isDirectory: true)
    }

    init(mode: GameMode, only: Set<String>? = nil) {
        self.mode = mode
        self.only = only
    }

    func start() {
        guard session == nil, !finished, entries.isEmpty else { return }
        run(position: 0)
    }

    /// `position` walks `indices`; `index` is the catalog index it maps to.
    private func run(position: Int) {
        guard position < indices.count else {
            finish()
            return
        }
        let index = indices[position]
        current = position
        completed = false
        guard mode == .drawLine, let level = try? catalog.load(DrawLevel.self, mode: mode, index: index) else {
            entries.append(Entry(id: catalog.id(for: mode, index: index), name: "?", outcome: "error",
                                 seconds: 0, stars: 0, detail: "could not load level"))
            run(position: position + 1)
            return
        }
        let scene = DrawScene(level: level, index: index)
        if let solution = level.solution { scene.replay(solution) }
        let newSession = GameSession(mode: mode, scene: scene)
        session = newSession
        startedAt = Date()
        let timeout = (level.solution?.waitSeconds ?? 6) + 2
        phaseWatch = newSession.$phase.sink { [weak self] phase in
            if phase.isOver { self?.complete(level: level, position: position, phase: phase) }
        }
        timer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            self?.complete(level: level, position: position, phase: nil)
        }
    }

    private func complete(level: DrawLevel, position: Int, phase: GamePhase?) {
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
            detail = "ink \(Int(score ?? 0))"
        } else if case .lost(let reason)? = phase {
            outcome = "lost"
            detail = reason
        }
        if level.solution == nil {
            outcome = "no-solution"
            detail = "level has no stored solution"
        }
        if let scene = session?.scene as? DrawScene, let image = scene.snapshot() {
            save(image, name: "\(mode.rawValue)-\(level.id).png")
        }
        entries.append(Entry(id: level.id, name: level.name, outcome: outcome,
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
        if let data = try? encoder.encode(entries) {
            try? data.write(to: dir.appendingPathComponent("\(mode.rawValue).json"), options: .atomic)
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

    init(mode: GameMode, only: Set<String>? = nil) {
        _runner = StateObject(wrappedValue: AutoplayRunner(mode: mode, only: only))
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
                        Text("AUTOPLAY \(runner.current + 1)/\(runner.count)")
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
                        Text("AUTOPLAY").font(Theme.title(24))
                        Spacer()
                        IconButton(icon: .close) { dismiss() }
                    }
                    Text("\(runner.passedCount)/\(runner.entries.count) passed")
                        .font(Theme.mono(14))
                        .foregroundStyle(runner.passedCount == runner.entries.count ? Theme.runner : Theme.danger)
                    ScrollView {
                        VStack(spacing: 6) {
                            ForEach(runner.entries) { entry in
                                HStack(spacing: 8) {
                                    Text(entry.id).font(Theme.mono(13)).frame(width: 30, alignment: .leading)
                                    Text(entry.name).font(Theme.label(13))
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
