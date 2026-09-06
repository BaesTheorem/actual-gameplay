import SpriteKit

/// Plumbing shared by every mode's scene: the fixed canvas, frame timing, deferred contact
/// handling, and the one-shot result report. Gameplay lives in the subclasses.
class GameSceneBase: SKScene, SKPhysicsContactDelegate {
    /// iPhone 16 Pro logical size. Levels are authored in these coordinates and `.aspectFit`
    /// letterboxes other screens, so stored solutions behave identically everywhere.
    static let canvas = CGSize(width: 402, height: 874)
    /// Canvas minus the Dynamic Island band on top and the home indicator band at the bottom.
    static let playfield = CGRect(x: 0, y: 34, width: 402, height: 874 - 34 - 60)

    weak var session: GameSession?
    let contacts = ContactQueue()
    private(set) var finished = false
    private var lastTime: TimeInterval?
    private var built = false

    override init(size: CGSize) {
        super.init(size: size)
        scaleMode = .aspectFit
        anchorPoint = .zero
        backgroundColor = UIColor(hex: 0x111318)
        physicsWorld.contactDelegate = self
    }

    required init?(coder aDecoder: NSCoder) { fatalError("scenes are built in code") }

    override func didMove(to view: SKView) {
        super.didMove(to: view)
        if !built {
            built = true
            buildLevel()
        }
    }

    /// Populate the scene. Called on first presentation and again after every reset.
    func buildLevel() {}

    /// Per-frame game logic with a clamped delta: a hitch or a resume never produces a huge step.
    func tick(dt: TimeInterval) {}

    /// The frame's contacts, one per node pair. Runs after the physics step, so removing nodes is safe.
    func handle(contacts: [ContactEvent]) {}

    /// Runs after `handle(contacts:)` every frame, still outside the physics step.
    func afterPhysics() {}

    func resetLevel() {
        removeAllActions()
        removeAllChildren()
        physicsWorld.removeAllJoints()
        physicsBody = nil
        contacts.clear()
        finished = false
        lastTime = nil
        isPaused = false
        buildLevel()
    }

    override func update(_ currentTime: TimeInterval) {
        let dt = lastTime.map { min(currentTime - $0, 1.0 / 20) } ?? 0
        lastTime = currentTime
        tick(dt: dt)
    }

    override func didSimulatePhysics() {
        let events = contacts.drain()
        if !events.isEmpty { handle(contacts: events) }
        afterPhysics()
    }

    func didBegin(_ contact: SKPhysicsContact) {
        contacts.record(contact)
    }

    /// Publish HUD state. Deferred a turn because the first build runs inside SpriteView's
    /// presentation, which is a SwiftUI update, and publishing there trips a runtime warning.
    func setHUD(_ hud: HUDState) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let session = self.session, session.hud != hud else { return }
            session.hud = hud
        }
    }

    /// Report the outcome once. Later calls in the same attempt are ignored.
    func finish(_ outcome: GamePhase) {
        guard !finished else { return }
        finished = true
        DispatchQueue.main.async { [weak self] in self?.session?.finish(outcome) }
    }
}
