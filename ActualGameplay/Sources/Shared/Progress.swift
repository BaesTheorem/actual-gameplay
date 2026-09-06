import Foundation

struct LevelResult: Codable, Equatable {
    var cleared: Bool = false
    var bestStars: Int = 0
    /// Ink used or pins pulled on the best clear. Lower is better.
    var bestScore: Double? = nil

    init(cleared: Bool = false, bestStars: Int = 0, bestScore: Double? = nil) {
        self.cleared = cleared
        self.bestStars = bestStars
        self.bestScore = bestScore
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cleared = try c.decodeIfPresent(Bool.self, forKey: .cleared) ?? false
        bestStars = try c.decodeIfPresent(Int.self, forKey: .bestStars) ?? 0
        bestScore = try c.decodeIfPresent(Double.self, forKey: .bestScore)
    }
}

struct RunnerProgress: Codable, Equatable {
    var level: Int = 0
    var bestLevel: Int = 0
    var coins: Int = 0
    var upgrades: [String: Int] = [:]

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        level = try c.decodeIfPresent(Int.self, forKey: .level) ?? 0
        bestLevel = try c.decodeIfPresent(Int.self, forKey: .bestLevel) ?? 0
        coins = try c.decodeIfPresent(Int.self, forKey: .coins) ?? 0
        upgrades = try c.decodeIfPresent([String: Int].self, forKey: .upgrades) ?? [:]
    }
}

struct GameSettings: Codable, Equatable {
    var haptics: Bool = true
    var music: Bool = true

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        haptics = try c.decodeIfPresent(Bool.self, forKey: .haptics) ?? true
        music = try c.decodeIfPresent(Bool.self, forKey: .music) ?? true
    }
}

/// Everything the app remembers. Keys are strings throughout: `[Int: T]` encodes as an array.
struct Progress: Codable, Equatable {
    static let currentSchema = 1

    var schemaVersion: Int = Progress.currentSchema
    var drawLine: [String: LevelResult] = [:]
    var pinPull: [String: LevelResult] = [:]
    var runner = RunnerProgress()
    var settings = GameSettings()

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        drawLine = try c.decodeIfPresent([String: LevelResult].self, forKey: .drawLine) ?? [:]
        pinPull = try c.decodeIfPresent([String: LevelResult].self, forKey: .pinPull) ?? [:]
        runner = try c.decodeIfPresent(RunnerProgress.self, forKey: .runner) ?? RunnerProgress()
        settings = try c.decodeIfPresent(GameSettings.self, forKey: .settings) ?? GameSettings()
    }

    func results(for mode: GameMode) -> [String: LevelResult] {
        switch mode {
        case .drawLine: return drawLine
        case .pinPull: return pinPull
        case .runner: return [:]
        }
    }

    /// Keep the best of the old and new result for a level.
    mutating func record(mode: GameMode, levelID: String, stars: Int, score: Double?) {
        var result = results(for: mode)[levelID] ?? LevelResult()
        result.cleared = true
        result.bestStars = max(result.bestStars, stars)
        if let score {
            result.bestScore = result.bestScore.map { min($0, score) } ?? score
        }
        switch mode {
        case .drawLine: drawLine[levelID] = result
        case .pinPull: pinPull[levelID] = result
        case .runner: break
        }
    }
}
