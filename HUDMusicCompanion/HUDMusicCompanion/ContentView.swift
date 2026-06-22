import SwiftUI

struct ContentView: View {
    @ObservedObject var state: AppState

    var body: some View {
        ZStack {
            // Background Gradient
            LinearGradient(
                colors: [Color(red: 0.05, green: 0.05, blue: 0.08), Color(red: 0.08, green: 0.08, blue: 0.12)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    // Header Area
                    VStack(spacing: 4) {
                        Text("HUD MUSIC")
                            .font(.system(size: 28, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                            .tracking(3)
                        
                        Text("Apple Music G2 Companion")
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundColor(.gray)
                    }
                    .padding(.top, 24)

                    // 1. Connection / Server Status Card
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Bridge Server")
                                .font(.headline)
                                .foregroundColor(.white)
                            Spacer()
                            
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(state.serverRunning ? Color.green : Color.red)
                                    .frame(width: 8, height: 8)
                                    .shadow(color: state.serverRunning ? .green : .red, radius: 4)
                                
                                Text(state.serverRunning ? "Running" : "Offline")
                                    .font(.footnote)
                                    .bold()
                                    .foregroundColor(state.serverRunning ? .green : .red)
                            }
                        }
                        
                        Divider()
                            .background(Color.white.opacity(0.1))
                        
                        HStack {
                            Text("Local Address:")
                                .font(.subheadline)
                                .foregroundColor(.gray)
                            Spacer()
                            Text("http://localhost:\(String(state.serverPort))")
                                .font(.system(.subheadline, design: .monospaced))
                                .foregroundColor(.white)
                        }

                        HStack {
                            Text("Music Permission:")
                                .font(.subheadline)
                                .foregroundColor(.gray)
                            Spacer()
                            Text(state.musicAuthorized ? "Authorized" : "Not Authorized")
                                .font(.subheadline)
                                .bold()
                                .foregroundColor(state.musicAuthorized ? .green : .orange)
                        }
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white.opacity(0.04))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.08), lineWidth: 1))
                    )
                    .padding(.horizontal)

                    // 2. Active Song Information Card
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Now Playing")
                            .font(.headline)
                            .foregroundColor(.white)
                        
                        HStack(spacing: 16) {
                            // Artwork
                            if let data = Data(base64Encoded: state.music.artwork),
                               let uiImage = UIImage(data: data) {
                                Image(uiImage: uiImage)
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: 76, height: 76)
                                    .cornerRadius(12)
                                    .shadow(color: .black.opacity(0.5), radius: 8)
                            } else {
                                Image(systemName: "music.note")
                                    .font(.system(size: 32))
                                    .foregroundColor(Color(red: 0.0, green: 1.0, blue: 0.4))
                                    .frame(width: 76, height: 76)
                                    .background(Color.black.opacity(0.3))
                                    .cornerRadius(12)
                                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), lineWidth: 1))
                            }
                            
                            // Song Metadata
                            VStack(alignment: .leading, spacing: 4) {
                                Text(state.music.title)
                                    .font(.system(size: 17, weight: .bold))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                                
                                Text(state.music.artist)
                                    .font(.subheadline)
                                    .foregroundColor(.gray)
                                    .lineLimit(1)
                                
                                Text(state.music.album)
                                    .font(.caption)
                                    .foregroundColor(.gray.opacity(0.8))
                                    .lineLimit(1)
                            }
                            Spacer()
                        }
                        
                        // Progress Bar & Duration
                        if state.music.duration > 0 {
                            VStack(spacing: 6) {
                                ProgressView(value: state.music.progress, total: state.music.duration)
                                    .accentColor(Color(red: 0.0, green: 1.0, blue: 0.4))
                                    .background(Color.white.opacity(0.1))
                                
                                HStack {
                                    Text(formatTime(state.music.progress))
                                        .font(.caption2)
                                        .foregroundColor(.gray)
                                    Spacer()
                                    Text(formatTime(state.music.duration))
                                        .font(.caption2)
                                        .foregroundColor(.gray)
                                }
                            }
                        } else {
                            ProgressView(value: 0, total: 100)
                                .accentColor(.gray)
                                .background(Color.white.opacity(0.1))
                        }
                        
                        // Custom Player Control Bar
                        HStack(spacing: 24) {
                            Spacer()
                            Button(action: { state.prevTrack() }) {
                                Image(systemName: "backward.fill")
                                    .font(.title2)
                                    .foregroundColor(.white)
                            }
                            
                            Button(action: { state.togglePlayPause() }) {
                                Image(systemName: state.music.playbackState == "playing" ? "pause.circle.fill" : "play.circle.fill")
                                    .font(.system(size: 48))
                                    .foregroundColor(Color(red: 0.0, green: 1.0, blue: 0.4))
                            }
                            
                            Button(action: { state.nextTrack() }) {
                                Image(systemName: "forward.fill")
                                    .font(.title2)
                                    .foregroundColor(.white)
                            }
                            Spacer()
                        }
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white.opacity(0.04))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.08), lineWidth: 1))
                    )
                    .padding(.horizontal)

                    // 3. Demo / Simulation Control Card
                    VStack(alignment: .leading, spacing: 14) {
                        Toggle(isOn: Binding(
                            get: { state.demoActive },
                            set: { if $0 { state.startDemo() } else { state.stopDemo() } }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Simulator Mode")
                                    .font(.headline)
                                    .foregroundColor(.white)
                                Text("Simulate playback for testing in Even Hub")
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                        }
                        .toggleStyle(SwitchToggleStyle(tint: Color(red: 0.0, green: 1.0, blue: 0.4)))
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white.opacity(0.04))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.08), lineWidth: 1))
                    )
                    .padding(.horizontal)

                    // 4. Live Server logs console card
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Live Server Activity")
                            .font(.headline)
                            .foregroundColor(.white)
                        
                        Divider()
                            .background(Color.white.opacity(0.1))
                        
                        ScrollView {
                            VStack(alignment: .leading, spacing: 6) {
                                if state.consoleLogs.isEmpty {
                                    Text("No connection activity yet...")
                                        .font(.system(.caption, design: .monospaced))
                                        .foregroundColor(.gray)
                                } else {
                                    ForEach(state.consoleLogs, id: \.self) { log in
                                        Text(log)
                                            .font(.system(.caption, design: .monospaced))
                                            .foregroundColor(.green.opacity(0.85))
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                }
                            }
                        }
                        .frame(height: 120)
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.black.opacity(0.4))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.08), lineWidth: 1))
                    )
                    .padding(.horizontal)
                    .padding(.bottom, 24)
                }
            }
        }
    }

    private func formatTime(_ seconds: Double) -> String {
        guard !seconds.isNaN && seconds >= 0 else { return "0:00" }
        let m = Int(seconds / 60)
        let s = Int(seconds) % 60
        return String(format: "%d:%02d", m, s)
    }
}
