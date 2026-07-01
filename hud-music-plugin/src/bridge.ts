import type { MusicData, BridgeStatus } from './types';

let bridgeBase = 'http://localhost:8766';
try {
  bridgeBase = localStorage.getItem('music_bridge_base_url') || 'http://localhost:8766';
} catch (e) {
  console.warn('[Bridge] localStorage not accessible:', e);
}

export function getBridgeBase(): string {
  return bridgeBase;
}

export function setBridgeBase(url: string): void {
  bridgeBase = url;
  try {
    localStorage.setItem('music_bridge_base_url', url);
  } catch (e) {
    console.warn('[Bridge] Failed to write to localStorage:', e);
  }
}

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 3000;
const DISCONNECT_AFTER_FAILURES = 3;
const DISCONNECT_AFTER_MS = 8000;

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
  const timer = setTimeout(() => {
    console.warn(`[Bridge] Fetch timeout (${TIMEOUT_MS}ms) for ${url}`);
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP status code ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[Bridge] Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function postAction(endpoint: string): Promise<boolean> {
  const url = `${getBridgeBase()}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.warn(`[Bridge] Action timeout (${TIMEOUT_MS}ms) for ${url}`);
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return res.ok;
  } catch (err) {
    console.error(`[Bridge] Post action failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    clearTimeout(timer);
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
let _isFetching = false;
let _consecutiveFailures = 0;
let _lastSuccessAt = 0;
let _lastGoodStatus: BridgeStatus | null = null;

export function startPolling(onUpdate: OnUpdateCallback): void {
  stopPolling();
  _isFetching = false;
  _consecutiveFailures = 0;
  _lastSuccessAt = 0;
  _lastGoodStatus = null;

  const poll = async () => {
    if (_isFetching) return;
    _isFetching = true;
    try {
      const status = await fetchStatus();
      _consecutiveFailures = 0;
      _lastSuccessAt = Date.now();
      _lastGoodStatus = status;
      onUpdate(status, null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bridge unreachable';
      _consecutiveFailures++;

      const staleFor = _lastSuccessAt > 0 ? Date.now() - _lastSuccessAt : Number.POSITIVE_INFINITY;
      const shouldDisconnect =
        _consecutiveFailures >= DISCONNECT_AFTER_FAILURES ||
        staleFor >= DISCONNECT_AFTER_MS ||
        _lastGoodStatus === null;

      if (shouldDisconnect) {
        onUpdate(
          {
            music: MUSIC_DEFAULT,
            serverVersion: '0.0.0',
          },
          msg,
        );
      } else {
        console.warn(`[Bridge] Transient poll failure ${_consecutiveFailures}/${DISCONNECT_AFTER_FAILURES}: ${msg}`);
      }
    } finally {
      _isFetching = false;
    }
  };

  poll();
  _pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  _isFetching = false;
}
