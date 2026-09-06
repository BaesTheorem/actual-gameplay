import Combine
import Foundation

/// Loads progress at launch and writes it back atomically on every change.
final class ProgressStore: ObservableObject {
    static let shared = ProgressStore()

    @Published private(set) var progress: Progress
    let fileURL: URL

    private var backupURL: URL { fileURL.deletingPathExtension().appendingPathExtension("bak") }

    init(directory: URL? = nil) {
        let dir = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ActualGameplay", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("progress.json")
        progress = ProgressStore.load(from: fileURL) ?? Progress()
    }

    static func load(from url: URL) -> Progress? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Progress.self, from: data)
    }

    func update(_ mutate: (inout Progress) -> Void) {
        var copy = progress
        mutate(&copy)
        guard copy != progress else { return }
        progress = copy
        save()
    }

    func resetAll() {
        progress = Progress()
        save()
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(progress) else { return }
        let fm = FileManager.default
        if fm.fileExists(atPath: fileURL.path) {
            try? fm.removeItem(at: backupURL)
            try? fm.copyItem(at: fileURL, to: backupURL)
        }
        try? data.write(to: fileURL, options: .atomic)
    }
}
