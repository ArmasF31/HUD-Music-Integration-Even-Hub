import type { MusicData } from './types';

// Format seconds into m:ss
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Generate a string progress bar like [====------]
export function buildProgressBar(progress: number, duration: number, charWidth: number = 18): string {
  if (duration <= 0) {
    return `[${'-'.repeat(charWidth)}]`;
  }
  const percent = Math.min(1, Math.max(0, progress / duration));
  const filled = Math.round(percent * charWidth);
  const empty = charWidth - filled;
  return `[${'='.repeat(filled)}${'-'.repeat(empty)}]`;
}

// Format track lines for split mode (Text on left, art on right)
// Left text container is width ~370px, ~30 monospace chars
export function buildPlayerLines(music: MusicData): string[] {
  if (music.playbackState === 'stopped') {
    return [
      'Apple Music Bridge',
      'Standby Mode',
      '',
      'Open the companion app',
      'on your iPhone to start.',
    ];
  }

  // Format details, truncating if they exceed length
  const title = truncate(music.title, 26);
  const artist = truncate(music.artist, 26);
  const album = truncate(music.album, 26);
  
  const stateIcon = music.playbackState === 'playing' ? '▶' : '‖';
  const timeInfo = `${stateIcon} ${formatTime(music.progress)} / ${formatTime(music.duration)}`;
  const progressStr = buildProgressBar(music.progress, music.duration, 16);

  return [
    title,
    artist,
    album,
    timeInfo,
    progressStr,
  ];
}

// Format track lines for full-screen text mode
// Container is width 536px, fits ~44 monospace chars
export function buildTextLines(music: MusicData): string[] {
  if (music.playbackState === 'stopped') {
    return [
      '    Apple Music Bridge - Standby',
      '',
      '   Connect the companion iOS app and',
      '   start playing music in Apple Music.',
    ];
  }

  const title = truncate(music.title, 38);
  const artist = truncate(music.artist, 38);
  const album = truncate(music.album, 38);
  
  const stateLabel = music.playbackState === 'playing' ? 'Playing' : 'Paused';
  const timeInfo = `${stateLabel} • ${formatTime(music.progress)} / ${formatTime(music.duration)}`;
  const progressStr = buildProgressBar(music.progress, music.duration, 26);

  return [
    `Song:   ${title}`,
    `Artist: ${artist}`,
    `Album:  ${album}`,
    `Status: ${timeInfo}`,
    `        ${progressStr}`,
  ];
}

function truncate(str: string, maxLen: number): string {
  if (!str) return 'Unknown';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

// Draw base64 artwork to high-contrast monochrome G2 PNG
export async function processArtwork(base64: string): Promise<string> {
  if (!base64) return '';
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = 110;
      const height = 110;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('');
        return;
      }
      
      // Clear background to solid black
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      
      // Pre-filter: Grayscale and normalize/enhance contrast slightly
      ctx.filter = 'grayscale(100%) contrast(140%) brightness(100%)';
      ctx.drawImage(img, 0, 0, width, height);
      
      // Apply Floyd-Steinberg dithering
      floydSteinbergDither(ctx, width, height);
      
      const dataUrl = canvas.toDataURL('image/png');
      resolve(dataUrl.split(',')[1]); // return raw base64 data portion
    };
    img.onerror = () => {
      resolve('');
    };
    if (base64.startsWith('data:')) {
      img.src = base64;
    } else {
      img.src = `data:image/jpeg;base64,${base64}`;
    }
  });
}

function floydSteinbergDither(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const getIndex = (x: number, y: number) => (y * width + x) * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      
      // Since it's already grayscale, R = G = B. Grabbing R.
      let oldVal = data[idx];
      
      // Threshold to 1-bit black & white
      let newVal = oldVal < 128 ? 0 : 255;
      
      data[idx] = newVal;
      data[idx + 1] = newVal;
      data[idx + 2] = newVal;
      
      let err = oldVal - newVal;
      
      // Diffuse quantization error to neighbors
      if (x + 1 < width) {
        let nIdx = getIndex(x + 1, y);
        adjustPixel(data, nIdx, err * 7 / 16);
      }
      if (y + 1 < height) {
        if (x > 0) {
          let nIdx = getIndex(x - 1, y + 1);
          adjustPixel(data, nIdx, err * 3 / 16);
        }
        let nIdx = getIndex(x, y + 1);
        adjustPixel(data, nIdx, err * 5 / 16);
        if (x + 1 < width) {
          let nIdx = getIndex(x + 1, y + 1);
          adjustPixel(data, nIdx, err * 1 / 16);
        }
      }
    }
  }
  
  ctx.putImageData(imgData, 0, 0);
}

function adjustPixel(data: Uint8ClampedArray, idx: number, amount: number) {
  let val = data[idx] + amount;
  let clamped = Math.min(255, Math.max(0, val));
  data[idx] = clamped;
  data[idx + 1] = clamped;
  data[idx + 2] = clamped;
}

// Draw a default music note image
export function drawDefaultArtwork(): string {
  const width = 110;
  const height = 110;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  
  // Outer frame
  ctx.strokeStyle = '#00FF66';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, width - 20, height - 20);
  
  // Draw double eighth note
  ctx.fillStyle = '#00FF66';
  ctx.strokeStyle = '#00FF66';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Draw note heads
  ctx.beginPath();
  ctx.arc(35, 75, 10, 0, 2 * Math.PI);
  ctx.arc(70, 65, 10, 0, 2 * Math.PI);
  ctx.fill();
  
  // Draw stems
  ctx.beginPath();
  ctx.moveTo(45, 75);
  ctx.lineTo(45, 30);
  ctx.lineTo(80, 20);
  ctx.lineTo(80, 65);
  ctx.stroke();
  
  // Draw beam
  ctx.beginPath();
  ctx.moveTo(45, 30);
  ctx.lineTo(80, 20);
  ctx.lineWidth = 10;
  ctx.stroke();
  
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.split(',')[1];
}
