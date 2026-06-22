import type { MusicData, BridgeStatus } from './types';

let bridgeBase = localStorage.getItem('music_bridge_base_url') || 'http://localhost:8766';

export function getBridgeBase(): string {
  return bridgeBase;
}

export function setBridgeBase(url: string): void {
  bridgeBase = url;
  localStorage.setItem('music_bridge_base_url', url);
}

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 900;

// Default/fallback data when bridge is unreachable or no music is playing
export const MUSIC_DEFAULT: MusicData = {
  title: 'No Song Playing',
  artist: 'Apple Music Bridge',
  album: 'Standby Mode',
  playbackState: 'stopped',
  duration: 0,
  progress: 0,
  artwork: '',
  connected: false,
};

async function fetchWithTimeout<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function postAction(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${getBridgeBase()}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return res.ok;
  } catch (err) {
    console.error(`[Bridge] Failed to post to ${endpoint}:`, err);
    return false;
  }
}

export async function fetchStatus(): Promise<BridgeStatus> {
  return fetchWithTimeout<BridgeStatus>(`${getBridgeBase()}/status`);
}

export async function play(): Promise<boolean> {
  return postAction('/play');
}

export async function pause(): Promise<boolean> {
  return postAction('/pause');
}

export async function togglePlayPause(): Promise<boolean> {
  return postAction('/toggle');
}

export async function nextTrack(): Promise<boolean> {
  return postAction('/next');
}

export async function prevTrack(): Promise<boolean> {
  return postAction('/prev');
}

type OnUpdateCallback = (status: BridgeStatus, error: string | null) => void;

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling(onUpdate: OnUpdateCallback): void {
  stopPolling();
  const poll = async () => {
    try {
      const status = await fetchStatus();
      onUpdate(status, null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bridge unreachable';
      onUpdate(
        {
          music: MUSIC_DEFAULT,
          serverVersion: '0.0.0',
        },
        msg,
      );
    }
  };
  poll(); // immediate first call
  _pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}
