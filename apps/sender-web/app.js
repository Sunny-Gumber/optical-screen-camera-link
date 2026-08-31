import { createTransferPackets } from '../../packages/protocol/src/index.js';
import {
  V1_G16_C16,
  V2_S8_C32_R3,
  V21_S8_C16_R3,
  encodeOpticalFrame,
  encodeS8C32Frame,
  encodeS8C16Frame,
  renderOpticalFrameSvg,
} from '../../packages/optical-codec/src/index.js';

const message = document.querySelector('#message');
const profileSelect = document.querySelector('#profile');
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
let activeProfile = V21_S8_C16_R3;
let visualVariant = 0;

function selectedProfile() {
  if (profileSelect.value === 'v1') return V1_G16_C16;
  if (profileSelect.value === 'v21') return V21_S8_C16_R3;
  return V2_S8_C32_R3;
}

function encoderForProfile(profile) {
  if (profile.id === V21_S8_C16_R3.id) return encodeS8C16Frame;
  if (profile.id === V2_S8_C32_R3.id) return encodeS8C32Frame;
  return encodeOpticalFrame;
}

function isHybridProfile(profile) {
  return profile.id === V21_S8_C16_R3.id || profile.id === V2_S8_C32_R3.id;
}

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
    visualVariant: isHybridProfile(activeProfile) ? visualVariant : 0,
  });

  const inputBytes = new TextEncoder().encode(message.value).length;
  stats.innerHTML = [
    `Profile: ${activeProfile.id}`,
    `Input: ${inputBytes} bytes`,
    `Frame: ${currentIndex + 1}/${frames.length}`,
    `Session: ${transfer.sessionId}`,
    `DATA packets: ${transfer.dataPacketCount}`,
    `Chunk: ${transfer.chunkSize} bytes`,
    `Rate: ${currentRateLabel()}`,
    isHybridProfile(activeProfile) ? `Visual variant: ${visualVariant}` : null,
  ].filter(Boolean).map((value) => `<span class="tag">${value}</span>`).join('');
}

function generateFrames() {
  stopPlayback();
  activeProfile = selectedProfile();
  const encodeFrame = encoderForProfile(activeProfile);
  transfer = createTransferPackets(message.value, {
    chunkSize: activeProfile.recommendedProtocolPayloadBytes,
  });
  frames = transfer.packets.map((packet) => encodeFrame(packet, activeProfile));
  currentIndex = 0;
  visualVariant = 0;
  renderCurrentFrame();
}

function advanceFrame(step = 1) {
  if (!frames.length) return;
  currentIndex = (currentIndex + step + frames.length) % frames.length;
  if (isHybridProfile(activeProfile)) visualVariant = (visualVariant + 1) & 0xFFFF;
  renderCurrentFrame();
}

function startPlayback() {
  if (!frames.length) generateFrames();
  stopPlayback();
  playButton.textContent = 'Stop';
  const interval = Number(rateSelect.value) || 1000;
  timer = setInterval(() => advanceFrame(1), interval);
}

generateButton.addEventListener('click', generateFrames);
profileSelect.addEventListener('change', generateFrames);
previousButton.addEventListener('click', () => {
  stopPlayback();
  advanceFrame(-1);
});
nextButton.addEventListener('click', () => {
  stopPlayback();
  advanceFrame(1);
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
