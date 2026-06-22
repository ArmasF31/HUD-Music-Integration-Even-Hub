import Foundation
import AVFoundation

final class BackgroundKeeper {
    private var audioEngine: AVAudioEngine?
    private var audioPlayer: AVAudioPlayerNode?
    private var isRunning = false
    
    func start() {
        guard !isRunning else { return }
        
        let session = AVAudioSession.sharedInstance()
        do {
            // mixWithOthers is crucial: it prevents interrupting Apple Music or other active audio apps!
            try session.setCategory(.playback, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            print("[BackgroundKeeper] Failed to configure AVAudioSession: \(error)")
            return
        }
        
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        
        // Low sample rate is sufficient and saves energy
        let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
        engine.connect(player, to: engine.mainMixerNode, format: format)
        
        do {
            try engine.start()
            player.play()
            
            // Create a 1-second PCM buffer filled with silence (zeros)
            let frameCount = UInt32(format.sampleRate)
            if let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) {
                buffer.frameLength = frameCount
                if let floatData = buffer.floatChannelData?[0] {
                    for i in 0..<Int(frameCount) {
                        floatData[i] = 0.0
                    }
                }
                // Schedule to loop indefinitely
                player.scheduleBuffer(buffer, at: nil, options: .loops, completionHandler: nil)
            }
            
            self.audioEngine = engine
            self.audioPlayer = player
            self.isRunning = true
            print("[BackgroundKeeper] Silent audio engine started successfully.")
        } catch {
            print("[BackgroundKeeper] Failed to start audio engine: \(error)")
        }
    }
    
    func stop() {
        guard isRunning else { return }
        audioPlayer?.stop()
        audioEngine?.stop()
        audioPlayer = nil
        audioEngine = nil
        
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        isRunning = false
        print("[BackgroundKeeper] Silent audio engine stopped.")
    }
}
