import SwiftUI

@main
struct HUDMusicCompanionApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView(state: state)
                .onAppear {
                    state.start()
                }
        }
    }
}
