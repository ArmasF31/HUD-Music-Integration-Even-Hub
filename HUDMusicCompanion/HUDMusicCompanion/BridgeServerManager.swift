import Foundation
import Network

final class BridgeServerManager {
    private weak var state: AppState?
    private let port: UInt16
    private var listener: NWListener?
    private var connections: [NWConnection] = []

    init(state: AppState, port: UInt16 = 8766) {
        self.state = state
        self.port = port
    }

    func startServer() {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true

        guard let nwPort = NWEndpoint.Port(rawValue: port) else { return }

        do {
            listener = try NWListener(using: params, on: nwPort)
        } catch {
            print("[Server] Failed to create listener: \(error)")
            return
        }

        listener?.stateUpdateHandler = { [weak self] newState in
            switch newState {
            case .ready:
                let currentPort = self?.listener?.port?.rawValue ?? 0
                print("[Server] Listening on localhost:\(currentPort)")
                DispatchQueue.main.async {
                    self?.state?.serverRunning = true
                    self?.state?.log("Server listening on port \(currentPort)")
                }
            case .failed(let error):
                print("[Server] Listener failed: \(error)")
                DispatchQueue.main.async {
                    self?.state?.serverRunning = false
                    self?.state?.log("Server failed: \(error.localizedDescription)")
                }
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.start(queue: .global(qos: .userInitiated))
    }

    func stopServer() {
        listener?.cancel()
        listener = nil
        for conn in connections {
            conn.cancel()
        }
        connections.removeAll()
        DispatchQueue.main.async { [weak self] in
            self?.state?.serverRunning = false
            self?.state?.log("Server stopped")
        }
    }

    private func handleConnection(_ connection: NWConnection) {
        connections.append(connection)
        connection.start(queue: .global(qos: .userInitiated))

        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty {
                let requestStr = String(data: data, encoding: .utf8) ?? ""
                self.respond(to: requestStr, on: connection)
            }
            
            if error != nil || isComplete {
                self.connections.removeAll { $0 === connection }
            }
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
        let path = parts.count > 1 ? parts[1] : "/"

        if method == "OPTIONS" {
            let response = buildHTTPResponse(statusCode: 200, contentType: "text/plain", body: "", isCORSPreflight: true)
            connection.send(content: response.data(using: .utf8), completion: .contentProcessed({ _ in
                connection.cancel()
            }))
            return
        }

        var statusCode = 404
        var body = "{\"error\":\"not found\"}"

        if method == "GET" && path == "/status" {
            statusCode = 200
            var statusJson = "{}"
            DispatchQueue.main.sync {
                if let state = self.state {
                    statusJson = state.getMusicStatusJSON()
                }
            }
            body = statusJson
        } else if method == "GET" && path == "/health" {
            statusCode = 200
            body = "{\"ok\":true}"
        } else if method == "POST" {
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
                    statusCode = 404
                    body = "{\"error\":\"not found\",\"path\":\"\(path)\"}"
                }
            }
        }

        let response = buildHTTPResponse(statusCode: statusCode, contentType: "application/json", body: body)
        connection.send(content: response.data(using: .utf8), completion: .contentProcessed({ _ in
            connection.cancel()
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
