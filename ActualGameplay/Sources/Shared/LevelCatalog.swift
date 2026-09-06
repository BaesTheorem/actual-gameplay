import Foundation

/// Finds and decodes the bundled level files. They live in `Levels/<folder>/NN.json`, copied into
/// the bundle as a folder, so adding a level is adding a file. The filename stem is the level id.
final class LevelCatalog {
    static let shared = LevelCatalog()

    enum CatalogError: Error { case noSuchLevel(Int) }

    private var cache: [String: [URL]] = [:]
    private let bundle: Bundle

    init(bundle: Bundle = .main) { self.bundle = bundle }

    static func folder(for mode: GameMode) -> String? {
        switch mode {
        case .drawLine: return "drawline"
        case .pinPull: return "pinpull"
        case .runner: return nil
        }
    }

    func urls(for mode: GameMode) -> [URL] {
        guard let folder = LevelCatalog.folder(for: mode) else { return [] }
        if let cached = cache[folder] { return cached }
        let found = (bundle.urls(forResourcesWithExtension: "json", subdirectory: "Levels/\(folder)") ?? [])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        cache[folder] = found
        return found
    }

    func count(for mode: GameMode) -> Int { urls(for: mode).count }

    func ids(for mode: GameMode) -> [String] { urls(for: mode).map { $0.deletingPathExtension().lastPathComponent } }

    func id(for mode: GameMode, index: Int) -> String {
        let all = ids(for: mode)
        return all.indices.contains(index) ? all[index] : String(format: "%02d", index + 1)
    }

    func load<T: Decodable>(_ type: T.Type, mode: GameMode, index: Int) throws -> T {
        let list = urls(for: mode)
        guard list.indices.contains(index) else { throw CatalogError.noSuchLevel(index) }
        return try JSONDecoder().decode(T.self, from: Data(contentsOf: list[index]))
    }
}
