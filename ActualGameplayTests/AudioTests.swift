import AVFoundation
import XCTest
@testable import ActualGameplay

/// Every effect and loop must ship a file the player opens. This runs in the app host, so `Bundle.main`
/// is the app bundle and `Audio/sfx` is exactly what ships.
final class AudioTests: XCTestCase {
    func testEveryEffectHasAPlayableFile() throws {
        for event in SoundEvent.allCases {
            XCTAssertFalse(event.files.isEmpty, "\(event) has no file")
            XCTAssertTrue((0.05...1).contains(event.volume), "\(event): volume \(event.volume)")
            for file in event.files {
                let url = try XCTUnwrap(Audio.url(for: file), "\(event): \(file) is not in Audio/sfx")
                let player = try AVAudioPlayer(contentsOf: url)
                XCTAssertGreaterThan(player.duration, 0.03, "\(file) is empty")
                XCTAssertLessThanOrEqual(player.duration, 1.3, "\(file) is long for an effect")
            }
        }
    }

    func testEveryLoopHasAPlayableFile() throws {
        for loop in SoundLoop.allCases {
            let url = try XCTUnwrap(Audio.url(for: loop.file), "\(loop): \(loop.file) is not in Audio/sfx")
            let player = try AVAudioPlayer(contentsOf: url)
            XCTAssertTrue((0.95...2.05).contains(player.duration), "\(loop.file) runs \(player.duration) s")
            XCTAssertTrue((0.05...0.35).contains(loop.volume), "\(loop): volume \(loop.volume)")
        }
    }

    func testEffectsStayInBudget() throws {
        let dir = try XCTUnwrap(Bundle.main.url(forResource: "sfx", withExtension: nil, subdirectory: "Audio"))
        let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])
        let bytes = try files.reduce(0) { $0 + (try $1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
        XCTAssertLessThan(bytes, 3_000_000, "Audio/sfx is \(bytes) bytes")
    }

    func testSoundSettingDefaultsOn() throws {
        let json = #"{"settings": {"haptics": false, "music": false}}"#.data(using: .utf8)!
        let progress = try JSONDecoder().decode(Progress.self, from: json)
        XCTAssertTrue(progress.settings.sound, "a save from before the setting existed keeps sound on")
        XCTAssertFalse(progress.settings.music)
    }
}
