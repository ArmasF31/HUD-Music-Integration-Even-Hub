import Foundation
import Combine
import UIKit

struct MusicStatus: Codable {
    var title: String = "No Song Playing"
    var artist: String = "Apple Music Bridge"
    var album: String = "Standby Mode"
    var playbackState: String = "stopped" // playing, paused, stopped
    var duration: Double = 0
    var progress: Double = 0
    var artwork: String = "" // base64 string
    var connected: Bool = false
}

@MainActor
final class AppState: ObservableObject {
    @Published var music = MusicStatus()
    @Published var serverRunning = false
    @Published var serverPort: UInt16 = 8766
    @Published var musicAuthorized = false
    @Published var demoActive = false
    @Published var consoleLogs: [String] = []
    
    private(set) var musicManager: MusicManager!
    private(set) var serverManager: BridgeServerManager!
    private let backgroundKeeper = BackgroundKeeper()
    
    private var demoTimer: Timer?
    private var demoProgress: Double = 0
    private var demoTrackIndex = 0
    private var hasStarted = false
    
    // Mock tracks for Demo Mode
    private let demoTracks = [
        (title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration: 200.0),
        (title: "Levitating", artist: "Dua Lipa", album: "Future Nostalgia", duration: 203.0),
        (title: "Stay", artist: "The Kid LAROI & Justin Bieber", album: "F*CK LOVE 3", duration: 141.0),
        (title: "Starboy", artist: "The Weeknd", album: "Starboy", duration: 230.0)
    ]
    
    func log(_ message: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        let timestamp = formatter.string(from: Date())
        consoleLogs.append("[\(timestamp)] \(message)")
        if consoleLogs.count > 100 {
            consoleLogs.removeFirst()
        }
        print("[\(timestamp)] \(message)")
    }
    
    func start() {
        if hasStarted {
            log("HUD Music Companion already started")
            serverManager?.startServer()
            return
        }

        hasStarted = true
        musicManager = MusicManager(state: self)
        serverManager = BridgeServerManager(state: self, port: serverPort)
        
        musicManager.requestAuthorization()
        serverManager.startServer()
        setupBackgroundObservers()
        
        log("HUD Music Companion Started on port \(serverPort)")
    }
    
    func updateMusicStatus(_ status: MusicStatus) {
        if !demoActive {
            music = status
        }
    }
    
    func getMusicStatusJSON(includeArtwork: Bool = false) -> String {
        if !demoActive {
            musicManager.updateProgressOnly()
        }
        
        let encoder = JSONEncoder()
        encoder.outputFormatting = []
        
        struct Response: Codable {
            let music: MusicStatus
            let serverVersion: String
        }
        
        var responseMusic = music
        if !includeArtwork {
            responseMusic.artwork = ""
        }

        let response = Response(music: responseMusic, serverVersion: "1.0.0")
        
        if let data = try? encoder.encode(response),
           let jsonStr = String(data: data, encoding: .utf8) {
            return jsonStr
        }
        return "{}"
    }
    
    // MARK: - Playback controls (bridged from G2 post endpoints or UI)
    func play() {
        log("Action: Play")
        if demoActive {
            music.playbackState = "playing"
        } else {
            musicManager.play()
        }
    }
    
    func pause() {
        log("Action: Pause")
        if demoActive {
            music.playbackState = "paused"
        } else {
            musicManager.pause()
        }
    }
    
    func togglePlayPause() {
        log("Action: Toggle Play/Pause")
        if demoActive {
            music.playbackState = (music.playbackState == "playing") ? "paused" : "playing"
        } else {
            musicManager.togglePlayPause()
        }
    }
    
    func nextTrack() {
        log("Action: Next Track")
        if demoActive {
            demoTrackIndex = (demoTrackIndex + 1) % demoTracks.count
            demoProgress = 0
            loadDemoTrack()
        } else {
            musicManager.nextTrack()
        }
    }
    
    func prevTrack() {
        log("Action: Previous Track")
        if demoActive {
            demoTrackIndex = (demoTrackIndex - 1 + demoTracks.count) % demoTracks.count
            demoProgress = 0
            loadDemoTrack()
        } else {
            musicManager.prevTrack()
        }
    }
    
    // MARK: - Demo Mode
    func startDemo() {
        demoActive = true
        log("Demo Mode Activated")
        demoProgress = 0
        demoTrackIndex = 0
        loadDemoTrack()
        
        demoTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            Task { @MainActor in
                self.tickDemo()
            }
        }
    }
    
    func stopDemo() {
        demoActive = false
        log("Demo Mode Deactivated")
        demoTimer?.invalidate()
        demoTimer = nil
        musicManager.refreshStatus()
    }
    
    private func loadDemoTrack() {
        let track = demoTracks[demoTrackIndex]
        
        // Use a simple mock album art: Double eighth note drawn on canvas in Base64 (already processed)
        // This is a beautiful green/black mock album art
        let mockArtwork = "iVBORw0KGgoAAAANSUhEUgAAAG4AAABuCAYAAADgZlhTAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6AYWExYNMvG0pQAAALNJREFUeNrt18ENwCAQBMG0E/ffcmpQAAnwP6m8vV117rmu64N73i++32t/fX9uN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN44bN5cfC/sB+YtW1t24EFAAAAAASUVORK5CYII="
        
        music = MusicStatus(
            title: track.title,
            artist: track.artist,
            album: track.album,
            playbackState: "playing",
            duration: track.duration,
            progress: demoProgress,
            artwork: mockArtwork,
            connected: true
        )
        log("Demo playing: \(track.title) - \(track.artist)")
    }
    
    private func tickDemo() {
        guard music.playbackState == "playing" else { return }
        demoProgress += 1.0
        let currentTrack = demoTracks[demoTrackIndex]
        if demoProgress >= currentTrack.duration {
            nextTrack()
        } else {
            music.progress = demoProgress
        }
    }
    
    // MARK: - Background keep-alive
    private func setupBackgroundObservers() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            Task { @MainActor in
                self.handleDidEnterBackground()
            }
        }

        NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            Task { @MainActor in
                self.handleWillEnterForeground()
            }
        }
    }

    private func handleDidEnterBackground() {
        log("Entered background. Activating BackgroundKeeper to keep server active.")
        serverManager.startServer()
        backgroundKeeper.start()
    }

    private func handleWillEnterForeground() {
        log("Entering foreground. Stopping BackgroundKeeper.")
        backgroundKeeper.stop()
        serverManager.startServer()
        musicManager.refreshStatus()
    }
}
