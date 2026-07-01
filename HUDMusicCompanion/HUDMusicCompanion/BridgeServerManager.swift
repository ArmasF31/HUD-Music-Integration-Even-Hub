import Foundation
import Network

final class BridgeServerManager {
    private weak var state: AppState?
    private let port: UInt16
    private let serverQueue = DispatchQueue(label: "HUDMusicCompanion.BridgeServer", qos: .userInitiated)
    private var listener: NWListener?
    private var connections: [NWConnection] = []
    private var restartWorkItem: DispatchWorkItem?
    private var isStopping = false

    init(state: AppState, port: UInt16 = 8766) {
        self.state = state
        self.port = port
    }

    func startServer() {
        serverQueue.async { [weak self] in
            self?.startServerOnQueue()
        }
    }

    private func startServerOnQueue() {
        if listener != nil {
            return
        }

        isStopping = false
        restartWorkItem?.cancel()
        restartWorkItem = nil

        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true

        guard let nwPort = NWEndpoint.Port(rawValue: port) else { return }

        do {
            listener = try NWListener(using: params, on: nwPort)
        } catch {
            print("[Server] Failed to create listener: \(error)")
            logOnMain("Server failed to start: \(error.localizedDescription)", running: false)
            scheduleRestart()
            return
        }

        listener?.stateUpdateHandler = { [weak self] newState in
            self?.handleListenerState(newState)
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.start(queue: serverQueue)
    }

    private func handleListenerState(_ newState: NWListener.State) {
        switch newState {
        case .ready:
            let currentPort = listener?.port?.rawValue ?? 0
            print("[Server] Listening on localhost:\(currentPort)")
            logOnMain("Server listening on port \(currentPort)", running: true)
        case .failed(let error):
            print("[Server] Listener failed: \(error)")
            listener?.cancel()
            listener = nil
            logOnMain("Server failed: \(error.localizedDescription)", running: false)
            scheduleRestart()
        case .cancelled:
            listener = nil
            if !isStopping {
                logOnMain("Server listener cancelled unexpectedly", running: false)
                scheduleRestart()
            }
        default:
            break
        }
    }

    private func scheduleRestart() {
        guard !isStopping else { return }
        restartWorkItem?.cancel()

        let item = DispatchWorkItem { [weak self] in
            self?.startServerOnQueue()
        }
        restartWorkItem = item
        logOnMain("Server restart scheduled")
        serverQueue.asyncAfter(deadline: .now() + 2.0, execute: item)
    }

    private func logOnMain(_ message: String, running: Bool? = nil) {
        DispatchQueue.main.async { [weak self] in
            if let running {
                self?.state?.serverRunning = running
            }
            self?.state?.log(message)
        }
    }

    func stopServer() {
        serverQueue.async { [weak self] in
            guard let self = self else { return }
            self.isStopping = true
            self.restartWorkItem?.cancel()
            self.restartWorkItem = nil
            self.listener?.cancel()
            self.listener = nil
            for conn in self.connections {
                conn.cancel()
            }
            self.connections.removeAll()
            self.logOnMain("Server stopped", running: false)
        }
    }

    private func handleConnection(_ connection: NWConnection) {
        connections.append(connection)

        connection.stateUpdateHandler = { [weak self, weak connection] newState in
            guard let self = self, let connection = connection else { return }
            switch newState {
            case .failed(let error):
                print("[Server] Connection failed: \(error)")
                self.removeConnection(connection)
            case .cancelled:
                self.removeConnection(connection)
            default:
                break
            }
        }

        connection.start(queue: serverQueue)
        receiveRequest(on: connection)
    }

    private func receiveRequest(on connection: NWConnection, buffer: Data = Data()) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }

            if let error = error {
                print("[Server] Receive failed: \(error)")
                self.removeConnection(connection)
                connection.cancel()
                return
            }

            var requestData = buffer
            if let data = data, !data.isEmpty {
                requestData.append(data)
            }

            let headerEnd = Data("\r\n\r\n".utf8)
            if requestData.range(of: headerEnd) != nil || isComplete {
                guard !requestData.isEmpty else {
                    self.removeConnection(connection)
                    connection.cancel()
                    return
                }

                let requestStr = String(data: requestData, encoding: .utf8) ?? ""
                self.respond(to: requestStr, on: connection)
                return
            }

            self.receiveRequest(on: connection, buffer: requestData)
        }
    }

    private func removeConnection(_ connection: NWConnection) {
        serverQueue.async { [weak self] in
            self?.connections.removeAll { $0 === connection }
        }
    }

    private func respond(to request: String, on connection: NWConnection) {
        let lines = request.components(separatedBy: "\r\n")
        guard let firstLine = lines.first else {
            connection.cancel()
            return
        }
        let parts = firstLine.components(separatedBy: " ")
        let method = parts.count > 0 ? parts[0] : "GET"
        let requestPath = parts.count > 1 ? parts[1] : "/"
        let path = requestPath.components(separatedBy: "?").first ?? requestPath
        let includeArtwork = requestPath.contains("artwork=1")

        if method == "OPTIONS" {
            let response = buildHTTPResponse(statusCode: 200, contentType: "text/plain", body: "", isCORSPreflight: true)
            send(response, on: connection)
            return
        }

        var statusCode = 404
        var body = "{\"error\":\"not found\"}"

        if method == "GET" && path == "/status" {
            statusCode = 200
            var statusJson = "{}"
            DispatchQueue.main.sync {
                if let state = self.state {
                    statusJson = state.getMusicStatusJSON(includeArtwork: includeArtwork)
                }
            }
            body = statusJson
        } else if method == "GET" && path == "/health" {
            statusCode = 200
            body = "{\"ok\":true}"
        } else if method == "POST" {
            switch path {
            case "/play", "/pause", "/toggle", "/next", "/prev":
                statusCode = 200
                body = "{\"success\":true}"

                DispatchQueue.main.async { [weak self] in
                    guard let self = self, let state = self.state else { return }
                    switch path {
                    case "/play":
                        state.play()
                    case "/pause":
                        state.pause()
                    case "/toggle":
                        state.togglePlayPause()
                    case "/next":
                        state.nextTrack()
                    case "/prev":
                        state.prevTrack()
                    default:
                        break
                    }
                }
            default:
                statusCode = 404
                body = "{\"error\":\"not found\",\"path\":\"\(path)\"}"
            }
        }

        let response = buildHTTPResponse(statusCode: statusCode, contentType: "application/json", body: body)
        send(response, on: connection)
    }

    private func send(_ response: String, on connection: NWConnection) {
        connection.send(content: response.data(using: .utf8), completion: .contentProcessed({ [weak self, weak connection] error in
            if let error = error {
                print("[Server] Send failed: \(error)")
            }
            connection?.cancel()
            if let connection = connection {
                self?.removeConnection(connection)
            }
        }))
    }

    private func buildHTTPResponse(statusCode: Int, contentType: String = "application/json", body: String, isCORSPreflight: Bool = false) -> String {
        let statusText = statusCode == 200 ? "OK" : statusCode == 404 ? "Not Found" : "Error"
        var response = "HTTP/1.1 \(statusCode) \(statusText)\r\n"
        response += "Access-Control-Allow-Origin: *\r\n"
        response += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        response += "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
        response += "Connection: close\r\n"

        if isCORSPreflight {
            response += "Content-Length: 0\r\n\r\n"
        } else {
            let data = body.data(using: .utf8) ?? Data()
            response += "Content-Type: \(contentType)\r\n"
            response += "Content-Length: \(data.count)\r\n\r\n"
            response += body
        }
        return response
    }
}
