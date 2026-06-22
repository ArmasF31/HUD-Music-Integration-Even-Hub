import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ImageContainerProperty,
  ImageRawDataUpdate,
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
import {
  buildPlayerLines,
  processArtwork,
  drawDefaultArtwork,
} from './display';
import type { HudState, BridgeStatus } from './types';

// ─── State ────────────────────────────────────────────────────────────────────
const state: HudState = {
  mode: 'player',
  music: MUSIC_DEFAULT,
  lastUpdate: 0,
  bridgeConnected: false,
  error: null,
};

let lastArtworkBase64 = '';
let imageUpdateInProgress = false;
let initialRenderAllowed = false;

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// ─── G2 Display rendering ─────────────────────────────────────────────────────
function getLeftText(): string {
  if (!state.bridgeConnected) {
    return [
      'Apple Music Bridge',
      'not connected',
      '',
      'Check the companion app',
      'running on your iPhone.',
    ].join('\n');
  }
  
  return buildPlayerLines(state.music).join('\n');
}

// Container IDs
const LEFT_TEXT_ID = 21;
const RIGHT_ART_IMG_ID = 22;
const RIGHT_STATUS_TEXT_ID = 23;

function centerText(text: string, containerWidth: number): string {
  const charWidth = 12; // Monospace character width on G2 is ~12px
  const maxChars = Math.floor(containerWidth / charWidth);
  const len = text.length;
  if (len >= maxChars) return text;
  const spaces = Math.floor((maxChars - len) / 2);
  return ' '.repeat(spaces) + text;
}

async function render(bridge: EvenAppBridge): Promise<void> {
  try {
    // 1. Update left column text (Song details + time + progress bar)
    const leftText = getLeftText();
    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: LEFT_TEXT_ID,
      containerName: 'left_text',
      content: leftText,
    }));

    // 2. Update status text under album artwork
    const statusLabel = !state.bridgeConnected 
      ? 'OFFLINE' 
      : state.music.playbackState === 'playing' 
        ? 'PLAYING' 
        : state.music.playbackState === 'paused' 
          ? 'PAUSED' 
          : 'STANDBY';
          
    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: RIGHT_STATUS_TEXT_ID,
      containerName: 'right_status_text',
      content: centerText(statusLabel, 110),
    }));

    // 3. Update album art image raw data if the artwork base64 has changed
    const activeArtwork = state.bridgeConnected && state.music.playbackState !== 'stopped'
      ? (state.music.artwork || 'default_note')
      : 'default_note';

    if (initialRenderAllowed && activeArtwork !== lastArtworkBase64 && !imageUpdateInProgress) {
      imageUpdateInProgress = true;
      
      setTimeout(async () => {
        try {
          console.log('[Music] Artwork state changed. Refreshing image...');
          let pngBase64 = '';
          if (activeArtwork === 'default_note') {
            pngBase64 = drawDefaultArtwork();
          } else {
            pngBase64 = await processArtwork(activeArtwork);
          }
          
          if (pngBase64) {
            const bytes = base64ToUint8Array(pngBase64);
            await bridge.updateImageRawData(new ImageRawDataUpdate({
              containerID: RIGHT_ART_IMG_ID,
              containerName: 'right_art_img',
              imageData: bytes,
            }));
            lastArtworkBase64 = activeArtwork;
          }
        } catch (e) {
          console.error('[Music] Failed to update artwork image:', e);
        } finally {
          imageUpdateInProgress = false;
        }
      }, 50);
    }
  } catch (e) {
    console.error('[Music] Failed to update display:', e);
  }
}

// ─── Input handling ───────────────────────────────────────────────────────────
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

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function main() {
  console.log('[Music] Waiting for Even App Bridge…');
  const bridge = await waitForEvenAppBridge();
  console.log('[Music] Bridge ready');

  // Shutdown existing containers to apply fresh coordinates
  try {
    console.log('[Music] Shutting down existing container...');
    await bridge.shutDownPageContainer(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
  } catch (e) {
    console.warn('[Music] Clean start container shutdown failed:', e);
  }

  // Create Split layout: Left column fits track text info, right column fits album art & status
  const leftText = new TextContainerProperty({
    xPosition: 20,
    yPosition: 20,
    width: 370,
    height: 248,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: LEFT_TEXT_ID,
    containerName: 'left_text',
    content: getLeftText(),
    isEventCapture: 1,
  });

  const rightArtImg = new ImageContainerProperty({
    xPosition: 446,
    yPosition: 40,
    width: 110,
    height: 110,
    containerID: RIGHT_ART_IMG_ID,
    containerName: 'right_art_img',
  });

  const rightStatusText = new TextContainerProperty({
    xPosition: 446,
    yPosition: 175,
    width: 110,
    height: 60,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 0,
    containerID: RIGHT_STATUS_TEXT_ID,
    containerName: 'right_status_text',
    content: centerText('STANDBY', 110),
    isEventCapture: 0,
  });

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [leftText, rightStatusText],
      imageObject: [rightArtImg],
    })
  );
  console.log('[Music] Startup container created:', result === 0 ? 'success' : `failed (${result})`);

  if (result !== 0) {
    const success = await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 3,
        textObject: [leftText, rightStatusText],
        imageObject: [rightArtImg],
      })
    );
    console.log('[Music] Rebuilt container:', success ? 'success' : 'failed');
  }

  // Listen for touchpad gestures
  const unsubscribe = bridge.onEvenHubEvent((event: any) => {
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

    // Double tap → shutdown page container (exit plugin)
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      console.log('[Music] Double click, exiting plugin...');
      bridge.shutDownPageContainer(1);
      return;
    }

    if (
      eventType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      eventType === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      console.log('[Music] System exiting, stopping polling...');
      stopPolling();
      unsubscribe();
      return;
    }

    // Handles play/pause toggle or skip
    handleTouchpadEvent(eventType);
  });

  const statusEl = document.getElementById('connection-status');
  const statusDotEl = document.getElementById('status-dot');
  const ipInput = document.getElementById('bridge-ip') as HTMLInputElement;
  const portInput = document.getElementById('bridge-port') as HTMLInputElement;
  const saveBtn = document.getElementById('save-config') as HTMLButtonElement;

  // Initialize bridge details
  const currentBase = getBridgeBase();
  try {
    const url = new URL(currentBase);
    ipInput.value = url.hostname === 'localhost' ? '' : url.hostname;
    portInput.value = url.port || '8766';
  } catch (e) {
    ipInput.value = '';
    portInput.value = '8766';
  }

  const handlePollUpdate = (status: BridgeStatus, error: string | null) => {
    state.bridgeConnected = error === null;
    state.error = error;
    
    if (error === null) {
      state.music = status.music;
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

  // Start polling
  startPolling(handlePollUpdate);

  // Allow image rendering after a 1.2 second grace period
  setTimeout(() => {
    initialRenderAllowed = true;
    render(bridge);
  }, 1200);

  // Save config handler
  saveBtn.addEventListener('click', () => {
    const ip = ipInput.value.trim() || 'localhost';
    const port = portInput.value.trim() || '8766';
    let address = ip;
    if (!address.startsWith('http://') && !address.startsWith('https://')) {
      address = `http://${address}`;
    }
    const newBase = `${address}:${port}`;
    setBridgeBase(newBase);
    console.log('[Music] Updated bridge base to:', newBase);
    
    if (statusEl && statusDotEl) {
      statusEl.innerText = 'Connecting...';
      statusEl.style.color = '#f59e0b';
      statusDotEl.className = 'pulse-dot connecting';
    }
    initialRenderAllowed = false;
    startPolling(handlePollUpdate);
    setTimeout(() => {
      initialRenderAllowed = true;
      render(bridge);
    }, 1200);
  });
}

main().catch((err) => {
  console.error('[Music] Fatal startup error:', err);
});
