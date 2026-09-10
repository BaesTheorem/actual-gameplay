import XCTest
@testable import ActualGameplay

final class ProgressStoreTests: XCTestCase {
    private func freshDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    func testRoundTripKeepsBestResult() {
        let dir = freshDirectory()
        let store = ProgressStore(directory: dir)
        store.update { $0.record(mode: .saveDog, levelID: "03", stars: 2, score: 300) }
        store.update { $0.record(mode: .saveDog, levelID: "03", stars: 1, score: 250) }

        let reloaded = ProgressStore(directory: dir)
        let result = reloaded.progress.saveDog["03"]
        XCTAssertEqual(result?.cleared, true)
        XCTAssertEqual(result?.bestStars, 2)
        XCTAssertEqual(result?.bestScore, 250)
    }

    func testMissingKeysDecodeToDefaults() throws {
        let json = #"{"schemaVersion": 1, "runner": {"coins": 40}}"#.data(using: .utf8)!
        let progress = try JSONDecoder().decode(Progress.self, from: json)
        XCTAssertEqual(progress.runner.coins, 40)
        XCTAssertEqual(progress.runner.level, 0)
        XCTAssertTrue(progress.settings.haptics)
        XCTAssertTrue(progress.saveDog.isEmpty)
    }

    func testUnchangedUpdateDoesNotRewrite() throws {
        let dir = freshDirectory()
        let store = ProgressStore(directory: dir)
        store.update { $0.record(mode: .pinPull, levelID: "01", stars: 3, score: 1) }
        let before = try FileManager.default.attributesOfItem(atPath: store.fileURL.path)[.modificationDate] as? Date
        store.update { _ in }
        let after = try FileManager.default.attributesOfItem(atPath: store.fileURL.path)[.modificationDate] as? Date
        XCTAssertEqual(before, after)
    }
}
