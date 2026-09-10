import Foundation

/// The three permanent upgrades and what they do to a run.
struct RunnerEconomy: Equatable {
    enum Upgrade: String, CaseIterable, Identifiable {
        case startCrowd
        case memberPower
        case coinMultiplier

        var id: String { rawValue }

        var title: String {
            switch self {
            case .startCrowd: return "Starting crowd"
            case .memberPower: return "Member strength"
            case .coinMultiplier: return "Coin bonus"
            }
        }

        var maxLevel: Int { self == .startCrowd ? 20 : 10 }

        func cost(atLevel level: Int) -> Int {
            let base: Double
            let growth: Double
            switch self {
            case .startCrowd: base = 50; growth = 1.35
            case .memberPower: base = 80; growth = 1.4
            case .coinMultiplier: base = 60; growth = 1.4
            }
            return Int((base * pow(growth, Double(level))).rounded())
        }

        func effectText(atLevel level: Int) -> String {
            switch self {
            case .startCrowd: return "\(5 + 2 * level) runners"
            case .memberPower: return String(format: "%.2fx damage", 1 + 0.15 * Double(level))
            case .coinMultiplier: return String(format: "%.1fx coins", 1 + 0.2 * Double(level))
            }
        }
    }

    static let base = RunnerEconomy(levels: [:])

    var levels: [String: Int]

    func level(of upgrade: Upgrade) -> Int { levels[upgrade.rawValue] ?? 0 }

    var startCrowd: Int { 5 + 2 * level(of: .startCrowd) }
    var memberPower: Double { 1 + 0.15 * Double(level(of: .memberPower)) }
    var coinMultiplier: Double { 1 + 0.2 * Double(level(of: .coinMultiplier)) }

    func coins(forSurvivors survivors: Int) -> Int {
        Int((Double(survivors) * coinMultiplier).rounded()) + 10
    }
}
