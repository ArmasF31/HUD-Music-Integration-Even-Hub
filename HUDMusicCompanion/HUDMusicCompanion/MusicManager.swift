import Foundation
import MediaPlayer

@MainActor
final class MusicManager {
    private weak var state: AppState?
    private let player = MPMusicPlayerController.systemMusicPlayer
    
    init(state: AppState) {
        self.state = state
    }
    
    func requestAuthorization() {
        MPMediaLibrary.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self = self else { return }
                let authorized = (status == .authorized)
                self.state?.musicAuthorized = authorized
                self.state?.log("Apple Music authorization status: \(status == .authorized ? "Authorized" : "Denied")")
                
                if authorized {
                    self.setupObservers()
                    self.refreshStatus()
                }
            }
        }
    }
    
    private func setupObservers() {
        player.beginGeneratingPlaybackNotifications()
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleNowPlayingItemChange),
            name: .MPMusicPlayerControllerNowPlayingItemDidChange,
            object: player
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handlePlaybackStateChange),
            name: .MPMusicPlayerControllerPlaybackStateDidChange,
            object: player
        )
    }
    
    deinit {
        // Observers are removed automatically on iOS 9+, but we end generating notifications
        let p = player
        DispatchQueue.main.async {
            p.endGeneratingPlaybackNotifications()
        }
    }
    
    @objc private func handleNowPlayingItemChange() {
        Task { @MainActor in
            state?.log("System Notification: Track Changed")
            refreshStatus()
        }
    }
    
    @objc private func handlePlaybackStateChange() {
        Task { @MainActor in
            state?.log("System Notification: Playback State Changed")
            refreshStatus()
        }
    }
    
    func refreshStatus() {
        guard state?.musicAuthorized == true else { return }
        guard state?.demoActive == false else { return }
        
        let item = player.nowPlayingItem
        let title = item?.title ?? "No Song Playing"
        let artist = item?.artist ?? "Apple Music Bridge"
        let album = item?.albumTitle ?? "Standby Mode"
        
        let playbackStateStr: String
        switch player.playbackState {
        case .playing:
            playbackStateStr = "playing"
        case .paused:
            playbackStateStr = "paused"
        case .stopped:
            playbackStateStr = "stopped"
        default:
            playbackStateStr = "stopped"
        }
        
        let duration = item?.playbackDuration ?? 0.0
        let progress = player.currentPlaybackTime
        
        // Retrieve album artwork as Base64 JPEG
        var artworkBase64 = ""
        if let artwork = item?.artwork,
           let image = artwork.image(at: CGSize(width: 150, height: 150)) {
            if let data = image.jpegData(compressionQuality: 0.6) {
                artworkBase64 = data.base64EncodedString()
            }
        }
        
        let musicStatus = MusicStatus(
            title: title,
            artist: artist,
            album: album,
            playbackState: playbackStateStr,
            duration: duration,
            progress: progress,
            artwork: artworkBase64,
            connected: true
        )
        state?.updateMusicStatus(musicStatus)
    }
    
    func updateProgressOnly() {
        guard state?.musicAuthorized == true else { return }
        guard state?.demoActive == false else { return }
        
        // currentPlaybackTime is a Double representing seconds
        let progress = player.currentPlaybackTime
        state?.music.progress = progress
    }
    
    // MARK: - Playback controls
    func play() {
        guard state?.musicAuthorized == true else { return }
        player.play()
    }
    
    func pause() {
        guard state?.musicAuthorized == true else { return }
        player.pause()
    }
    
    func togglePlayPause() {
        guard state?.musicAuthorized == true else { return }
        if player.playbackState == .playing {
            player.pause()
        } else {
            player.play()
        }
    }
    
    func nextTrack() {
        guard state?.musicAuthorized == true else { return }
        player.skipToNextItem()
    }
    
    func prevTrack() {
        guard state?.musicAuthorized == true else { return }
        player.skipToPreviousItem()
    }
}
