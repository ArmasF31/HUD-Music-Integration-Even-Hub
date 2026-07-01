import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  RebuildPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import {
  startPolling,
  stopPolling,
  getBridgeBase,
  setBridgeBase,
  togglePlayPause,
  nextTrack,
  prevTrack,
  MUSIC_DEFAULT,
} from './bridge';
import type { HudState, BridgeStatus } from './types';

// --- State ---
const state: HudState = {
  mode: 'player',
  music: MUSIC_DEFAULT,
  lastUpdate: 0,
  bridgeConnected: false,
  error: null,
};

let lastSongText = '';
let lastBatteryText = '';
let lastProgressText = '';

// Hardware concurrency safety lock
let isRendering = false;
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL_MS = 1500; // Aligned with the 1.5s poll speed
let renderTimeout: ReturnType<typeof setTimeout> | null = null;

// Container IDs
const TITLE_TEXT_ID = 31;
const BATTERY_TEXT_ID = 32;
const TIME_TEXT_ID = 33;
const PROGRESS_TEXT_ID = 34;

// Fixed top-row layout. Keep the title lane well clear of the clock lane;
// text overflow can otherwise leak as a clipped artifact in the simulator.
const HUD_Y = 15;
const HUD_TEXT_HEIGHT = 30;
const BATTERY_X = 20;
const BATTERY_WIDTH = 85;
const PROGRESS_X = 120;
const PROGRESS_WIDTH = 145;
const TITLE_X = 278;
const TITLE_WIDTH = 220;
const TITLE_SAFE_WIDTH = 205;
const TITLE_MAX_CHARS = 24;
const TIME_X = 512;
const TIME_WIDTH = 56;

let currentBatteryLevel: number | null = null;

// Marquee scroll state
let marqueeScrollIndex = 0;
let lastSongTitle = '';
let lastPlaybackState = '';
let lastConnectedState = false;
let lastTimeText = '';
let isLayoutInitialized = false;

// --- Proportional Font Width & Slicing Helper Functions ---
function getStringPixelWidth(str: string): number {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === ' ') {
      width += 3.5;
    } else if ('iltjfrI1.,!:;/!;-()[]\'"'.includes(char)) {
      width += 5.5;
    } else if ('wmWM'.includes(char)) {
      width += 13.0;
    } else {
      width += 9.5;
    }
  }
  return Math.ceil(width);
}

function sliceToPixelWidth(str: string, maxPixelWidth: number): string {
  let currentW = 0;
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    let charW = 9.5;
    if (char === ' ') charW = 3.5;
    else if ('iltjfrI1.,!:;/!;-()[]\'"'.includes(char)) charW = 5.5;
    else if ('wmWM'.includes(char)) charW = 13.0;

    if (currentW + charW > maxPixelWidth) {
      break;
    }
    result += char;
    currentW += charW;
  }
  return result;
}

// --- UI Helper Getters ---
function formatFixedTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.min(99, Math.floor(totalSeconds / 60));
  const remainingSeconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getProgressText(): string {
  if (!state.bridgeConnected || state.music.playbackState === 'stopped') {
    return '';
  }

  const prog = formatFixedTime(state.music.progress);
  const dur = state.music.duration > 0 ? formatFixedTime(state.music.duration) : '--:--';
  return `[${prog}/${dur}]`;
}

function getRawSongTitle(): string {
  if (!state.bridgeConnected) {
    return 'Bridge Disconnected';
  } else if (state.music.playbackState === 'stopped') {
    return 'No Song Playing';
  } else {
    return state.music.title || 'Unknown Track';
  }
}

function getSongTitlePart(): string {
  const rawTitle = getRawSongTitle();
  const fullTitleWidth = getStringPixelWidth(rawTitle);
  
  if (fullTitleWidth <= TITLE_SAFE_WIDTH) {
    // Fits completely, no marquee needed
    return rawTitle.slice(0, TITLE_MAX_CHARS);
  }
  
  // Does not fit, apply marquee scroll
  const paddedTitle = rawTitle + "     "; // 5 spaces padding
  const len = paddedTitle.length;
  if (len === 0) return '';
  
  const idx = marqueeScrollIndex % len;
  const scrolled = paddedTitle.substring(idx) + paddedTitle.substring(0, idx);
  
  return sliceToPixelWidth(scrolled, TITLE_SAFE_WIDTH).slice(0, TITLE_MAX_CHARS).trimEnd();
}

function shouldScrollTitle(): boolean {
  return getStringPixelWidth(getRawSongTitle()) > TITLE_SAFE_WIDTH;
}

function getBatteryText(): string {
  if (currentBatteryLevel === null) {
    return '--%';
  }
  return `${currentBatteryLevel}%`;
}

function getCurrentTimeText(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function createTopRowContainers(): TextContainerProperty[] {
  return [
    new TextContainerProperty({
      xPosition: BATTERY_X,
      yPosition: HUD_Y,
      width: BATTERY_WIDTH,
      height: HUD_TEXT_HEIGHT,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 0,
      containerID: BATTERY_TEXT_ID,
      containerName: 'battery_text',
      content: getBatteryText(),
      isEventCapture: 0,
    }),
    new TextContainerProperty({
      xPosition: PROGRESS_X,
      yPosition: HUD_Y,
      width: PROGRESS_WIDTH,
      height: HUD_TEXT_HEIGHT,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 0,
      containerID: PROGRESS_TEXT_ID,
      containerName: 'progress_text',
      content: getProgressText(),
      isEventCapture: 0,
    }),
    new TextContainerProperty({
      xPosition: TITLE_X,
      yPosition: HUD_Y,
      width: TITLE_WIDTH,
      height: HUD_TEXT_HEIGHT,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 0,
      containerID: TITLE_TEXT_ID,
      containerName: 'title_text',
      content: getSongTitlePart(),
      isEventCapture: 1,
    }),
    new TextContainerProperty({
      xPosition: TIME_X,
      yPosition: HUD_Y,
      width: TIME_WIDTH,
      height: HUD_TEXT_HEIGHT,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 0,
      containerID: TIME_TEXT_ID,
      containerName: 'time_text',
      content: getCurrentTimeText(),
      isEventCapture: 0,
    }),
  ];
}

// --- Layout Coordinate Rebuilder ---
async function checkAndRebuildLayout(bridge: EvenAppBridge, force = false): Promise<void> {
  const rawTitle = getRawSongTitle();
  const playbackState = state.music.playbackState;
  const connected = state.bridgeConnected;

  // Geometry is fixed; rebuild only when the containers need to be recreated.
  if (
    force ||
    !isLayoutInitialized ||
    rawTitle !== lastSongTitle ||
    playbackState !== lastPlaybackState ||
    connected !== lastConnectedState
  ) {
    lastSongTitle = rawTitle;
    lastPlaybackState = playbackState;
    lastConnectedState = connected;
    isLayoutInitialized = true;

    try {
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 4,
          textObject: createTopRowContainers(),
        })
      );
      // Reset values to force visual refresh
      lastSongText = '';
      lastBatteryText = '';
      lastProgressText = '';
      lastTimeText = '';
    } catch (err) {
      console.error('[Music] Layout rebuild failed:', err);
    }
  }
}

// --- G2 Display rendering ---
async function render(bridge: EvenAppBridge): Promise<void> {
  if (isRendering) return;

  const now = Date.now();
  const timeSinceLastRender = now - lastRenderTime;

  if (timeSinceLastRender < MIN_RENDER_INTERVAL_MS) {
    if (!renderTimeout) {
      renderTimeout = setTimeout(() => {
        renderTimeout = null;
        render(bridge);
      }, MIN_RENDER_INTERVAL_MS - timeSinceLastRender);
    }
    return;
  }

  if (renderTimeout) {
    clearTimeout(renderTimeout);
    renderTimeout = null;
  }

  isRendering = true;
  lastRenderTime = Date.now();

  try {
    // 1. Check layout geometry and rebuild if track status or time changed
    await checkAndRebuildLayout(bridge);

    // 2. Update fixed-width progress counter
    const progressText = getProgressText();
    if (progressText !== lastProgressText) {
      lastProgressText = progressText;
      try {
        await bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: PROGRESS_TEXT_ID,
          containerName: 'progress_text',
          content: progressText,
        }));
      } catch (e) {
        console.error('[Music] Failed to upgrade progress text container:', e);
      }
    }

    // 3. Update title lane. Long titles scroll inside this lane only.
    const titleText = getSongTitlePart();
    if (titleText !== lastSongText) {
      lastSongText = titleText; // Set tracking variable immediately to prevent failing loop spams
      try {
        await bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: TITLE_TEXT_ID,
          containerName: 'title_text',
          content: titleText,
        }));
      } catch (e) {
        console.error('[Music] Failed to upgrade title text container:', e);
      }
    }

    // 4. Update battery text
    const batteryText = getBatteryText();
    if (batteryText !== lastBatteryText) {
      lastBatteryText = batteryText; // Set tracking variable immediately to prevent failing loop spams
      try {
        await bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: BATTERY_TEXT_ID,
          containerName: 'battery_text',
          content: batteryText,
        }));
      } catch (e) {
        console.error('[Music] Failed to upgrade battery text container:', e);
      }
    }

    // 5. Update clock in a fixed lane so changing glyph widths cannot move it.
    const timeText = getCurrentTimeText();
    if (timeText !== lastTimeText) {
      lastTimeText = timeText;
      try {
        await bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: TIME_TEXT_ID,
          containerName: 'time_text',
          content: timeText,
        }));
      } catch (e) {
        console.error('[Music] Failed to upgrade time text container:', e);
      }
    }
  } catch (e) {
    console.error('[Music] Failed to update display:', e);
  } finally {
    isRendering = false;
  }
}

// --- Input handling ---
async function handleTouchpadEvent(eventType: number | null) {
  if (eventType === null) return;
  
  if (eventType === OsEventTypeList.CLICK_EVENT) {
    console.log('[Music] G2 Click: Toggle Play/Pause');
    await togglePlayPause();
  } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
    console.log('[Music] G2 Swipe Up: Next Track');
    await nextTrack();
  } else if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    console.log('[Music] G2 Swipe Down: Previous Track');
    await prevTrack();
  }
}

// --- Bootstrap ---
async function main() {
  console.log('[Music] Waiting for Even App Bridge...');
  const bridge = await waitForEvenAppBridge();
  console.log('[Music] Bridge ready');

  // Query initial battery level on startup
  try {
    const devInfo = await bridge.getDeviceInfo();
    if (devInfo && devInfo.status && typeof devInfo.status.batteryLevel === 'number') {
      currentBatteryLevel = devInfo.status.batteryLevel;
      console.log('[Music] Initial battery level retrieved:', currentBatteryLevel);
    }
  } catch (e) {
    console.warn('[Music] Failed to get initial device status:', e);
  }

  lastSongTitle = getRawSongTitle();
  lastPlaybackState = state.music.playbackState;
  lastConnectedState = state.bridgeConnected;
  lastTimeText = getCurrentTimeText();
  isLayoutInitialized = true;
  const topRowContainers = createTopRowContainers();

  // Initializing hardware layout structure
  let result = -1;
  try {
    result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 4,
        textObject: topRowContainers,
      })
    );
    console.log('[Music] Startup container created:', result === 0 ? 'success' : `failed (${result})`);
  } catch (err) {
    console.error('[Music] Critical initialization crash:', err);
  }

  // Fallback rebuild
  if (result !== 0) {
    console.log('[Music] Container already exists, executing rebuild fallback...');
    try {
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 4,
          textObject: topRowContainers,
        })
      );
    } catch (rebuildErr) {
      console.error('[Music] Critical rebuild container failure:', rebuildErr);
    }
  }

  // Subscribe to device status changes (for battery level)
  const unsubscribeBattery = bridge.onDeviceStatusChanged((status) => {
    if (status && typeof status.batteryLevel === 'number') {
      if (status.batteryLevel !== currentBatteryLevel) {
        console.log('[Music] Device battery updated:', status.batteryLevel);
        currentBatteryLevel = status.batteryLevel;
        render(bridge);
      }
    }
  });

  // Listen for touchpad gestures
  const unsubscribeEvents = bridge.onEvenHubEvent((event: any) => {
    console.log('[Music] onEvenHubEvent raw:', JSON.stringify(event));

    const raw =
      event.listEvent?.eventType ??
      event.textEvent?.eventType ??
      event.sysEvent?.eventType ??
      event.jsonData?.eventType ??
      event.jsonData?.event_type ??
      event.jsonData?.Event_Type ??
      event.jsonData?.type;

    let eventType: number | null = null;

    if (raw === undefined || raw === null) {
      if (event.listEvent || event.textEvent || event.sysEvent) {
        eventType = OsEventTypeList.CLICK_EVENT;
      }
    } else if (typeof raw === 'number') {
      eventType = raw;
    } else if (typeof raw === 'string') {
      const v = raw.toUpperCase();
      if (v.includes('DOUBLE')) {
        eventType = OsEventTypeList.DOUBLE_CLICK_EVENT;
      } else if (v.includes('CLICK')) {
        eventType = OsEventTypeList.CLICK_EVENT;
      } else if (v.includes('SCROLL_TOP') || v.includes('UP')) {
        eventType = OsEventTypeList.SCROLL_TOP_EVENT;
      } else if (v.includes('SCROLL_BOTTOM') || v.includes('DOWN')) {
        eventType = OsEventTypeList.SCROLL_BOTTOM_EVENT;
      }
    }

    console.log('[Music] Resolved event type:', eventType);

    // Double tap -> shutdown page container (exit plugin)
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      console.log('[Music] Double click, exiting plugin...');
      stopPolling();
      unsubscribeEvents();
      unsubscribeBattery();
      bridge.shutDownPageContainer(1);
      return;
    }

    if (
      eventType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      eventType === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      console.log('[Music] System exiting, stopping polling...');
      stopPolling();
      unsubscribeEvents();
      unsubscribeBattery();
      return;
    }

    handleTouchpadEvent(eventType);
  });

  const statusEl = document.getElementById('connection-status');
  const statusDotEl = document.getElementById('status-dot');
  const ipInput = document.getElementById('bridge-ip') as HTMLInputElement;
  const portInput = document.getElementById('bridge-port') as HTMLInputElement;
  const saveBtn = document.getElementById('save-config') as HTMLButtonElement;

  try {
    const currentBase = getBridgeBase();
    if (currentBase && ipInput && portInput) {
      const url = new URL(currentBase);
      ipInput.value = url.hostname === 'localhost' ? '' : url.hostname;
      portInput.value = url.port || '8766';
    }
  } catch (e) {
    console.warn('[Music] Web user input configuration fields missing from DOM:', e);
  }

  const handlePollUpdate = (status: BridgeStatus, error: string | null) => {
    state.bridgeConnected = error === null;
    state.error = error;
    
    if (error === null) {
      const titleChanged = state.music.title !== status.music.title;
      state.music = status.music;

      // Manage marquee index
      if (titleChanged) {
        marqueeScrollIndex = 0;
      } else if (shouldScrollTitle()) {
        marqueeScrollIndex++;
      }

      state.lastUpdate = Date.now();
      
      if (statusEl && statusDotEl) {
        statusEl.innerText = 'Connected';
        statusEl.style.color = '#00FF66';
        statusDotEl.className = 'pulse-dot connected';
      }
    } else {
      state.music = MUSIC_DEFAULT;
      if (statusEl && statusDotEl) {
        statusEl.innerText = `Error: ${error}`;
        statusEl.style.color = '#FF3366';
        statusDotEl.className = 'pulse-dot error';
      }
    }
    render(bridge);
  };

  // DELAY BUFFER: Postpone background network worker requests 
  // until the micro-displays lock layout positions
  setTimeout(() => {
    startPolling(handlePollUpdate);
  }, 1500);

  // Save config handler
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const ip = ipInput ? ipInput.value.trim() : 'localhost';
      const port = portInput ? portInput.value.trim() : '8766';
      let address = ip || 'localhost';
      if (!address.startsWith('http://') && !address.startsWith('https://')) {
        address = `http://${address}`;
      }
      const newBase = `${address}:${port}`;
      
      stopPolling(); 
      setBridgeBase(newBase);
      console.log('[Music] Updated bridge base to:', newBase);
      
      if (statusEl && statusDotEl) {
        statusEl.innerText = 'Connecting...';
        statusEl.style.color = '#f59e0b';
        statusDotEl.className = 'pulse-dot connecting';
      }
      
      startPolling(handlePollUpdate);
      
      setTimeout(() => {
        render(bridge);
      }, 1200);
    });
  }
}

main().catch((err) => {
  console.error('[Music] Fatal startup error:', err);
  var errDiv = document.createElement('div');
  errDiv.style.position = 'fixed';
  errDiv.style.bottom = '0';
  errDiv.style.left = '0';
  errDiv.style.width = '100%';
  errDiv.style.background = 'rgba(255, 0, 0, 0.95)';
  errDiv.style.color = 'white';
  errDiv.style.padding = '15px';
  errDiv.style.boxSizing = 'border-box';
  errDiv.style.zIndex = '999999';
  errDiv.style.fontSize = '12px';
  errDiv.style.whiteSpace = 'pre-wrap';
  errDiv.style.textAlign = 'left';
  errDiv.innerText = "Fatal Startup Error:\n" + String(err) + "\n" + (err instanceof Error ? err.stack : "");
  document.body.appendChild(errDiv);
});
