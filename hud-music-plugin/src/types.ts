// Types for the Apple Music companion bridge app API responses

export interface MusicData {
  title: string;
  artist: string;
  album: string;
  playbackState: 'playing' | 'paused' | 'stopped';
  duration: number;        // total duration in seconds
  progress: number;        // elapsed progress in seconds
  artwork: string;         // base64-encoded image (JPEG/PNG) or empty
  connected: boolean;      // indicates if Apple Music subsystem is accessible
}

export interface BridgeStatus {
  music: MusicData;
  serverVersion: string;
}

export type HudMode = 'player' | 'text'; // 'player' shows artwork, 'text' shows large details

export interface HudState {
  mode: HudMode;
  music: MusicData;
  lastUpdate: number;
  bridgeConnected: boolean;
  error: string | null;
}
