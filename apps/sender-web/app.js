import { createTransferPackets } from '../../packages/protocol/src/index.js';
import {
  V1_G16_C16,
  encodeOpticalFrame,
  renderOpticalFrameSvg,
} from '../../packages/optical-codec/src/index.js';

const message = document.querySelector('#message');
const frameHost = document.querySelector('#frameHost');
const stats = document.querySelector('#stats');
const generateButton = document.querySelector('#generate');
const previousButton = document.querySelector('#previous');
const nextButton = document.querySelector('#next');
const playButton = document.querySelector('#play');
const rateSelect = document.querySelector('#rate');
const fullscreenButton = document.querySelector('#fullscreen');

let transfer = null;
let frames = [];
let currentIndex = 0;
let timer = null;

function stopPlayback() {
  if (timer) clearInterval(timer);
  timer = null;
  playButton.textContent = 'Play';
}

function currentRateLabel() {
  const option = rateSelect.options[rateSelect.selectedIndex];
  return option?.textContent ?? '1 fps';
}

function renderCurrentFrame() {
  if (!frames.length) {
    frameHost.textContent = 'Generate a frame to begin.';
    stats.textContent = '';
    return;
  }

  frameHost.innerHTML = renderOpticalFrameSvg(frames[currentIndex], {
    scale: 2,
    quietZone: 24,
    borderWidth: 4,
    showGrid: false,
  });

  const inputBytes = new TextEncoder().encode(message.value).length;
  stats.innerHTML = [
    `Profile: ${V1_G16_C16.id}`,
    `Input: ${inputBytes} bytes`,
    `Frame: ${currentIndex + 1}/${frames.length}`,
    `Session: ${transfer.sessionId}`,
    `DATA packets: ${transfer.dataPacketCount}`,
    `Chunk: ${transfer.chunkSize} bytes`,
    `Rate: ${currentRateLabel()}`,
  ].map((value) => `<span class="tag">${value}</span>`).join('');
}

function generateFrames() {
  stopPlayback();
  transfer = createTransferPackets(message.value, {
    chunkSize: V1_G16_C16.recommendedProtocolPayloadBytes,
  });
  frames = transfer.packets.map((packet) => encodeOpticalFrame(packet));
  currentIndex = 0;
  renderCurrentFrame();
}

function startPlayback() {
  if (!frames.length) generateFrames();
  stopPlayback();
  playButton.textContent = 'Stop';
  const interval = Number(rateSelect.value) || 1000;
  timer = setInterval(() => {
    currentIndex = (currentIndex + 1) % frames.length;
    renderCurrentFrame();
  }, interval);
}

generateButton.addEventListener('click', generateFrames);
previousButton.addEventListener('click', () => {
  stopPlayback();
  if (!frames.length) return;
  currentIndex = (currentIndex - 1 + frames.length) % frames.length;
  renderCurrentFrame();
});
nextButton.addEventListener('click', () => {
  stopPlayback();
  if (!frames.length) return;
  currentIndex = (currentIndex + 1) % frames.length;
  renderCurrentFrame();
});
playButton.addEventListener('click', () => {
  if (timer) stopPlayback();
  else startPlayback();
});
rateSelect.addEventListener('change', () => {
  const wasPlaying = Boolean(timer);
  if (wasPlaying) startPlayback();
  else renderCurrentFrame();
});
fullscreenButton.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await frameHost.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.error('Fullscreen failed', error);
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen Frame';
});

generateFrames();
