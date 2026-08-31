import { decodePacket, FRAME_TYPE_NAMES, PacketError, TransferReassembler } from '../../packages/protocol/src/index.js';
import { decodeRectifiedRoi } from './decoder.js';
import {
  drawGuideOverlay,
  drawVideoFrame,
  extractLogicalRoi,
  getCenteredGuideRect,
  rectifyGuide,
} from './vision.js';

const video = document.querySelector('#camera');
const sourceCanvas = document.querySelector('#sourceCanvas');
const rectifiedCanvas = document.querySelector('#rectifiedCanvas');
const roiCanvas = document.querySelector('#roiCanvas');
const startButton = document.querySelector('#startCamera');
const stopButton = document.querySelector('#stopCamera');
const resetButton = document.querySelector('#resetTransfer');
const toggleDebug = document.querySelector('#toggleDebug');
const cameraState = document.querySelector('#cameraState');
const lockState = document.querySelector('#lockState');
const packetState = document.querySelector('#packetState');
const transferState = document.querySelector('#transferState');
const output = document.querySelector('#output');
const metricsHost = document.querySelector('#metrics');
const logHost = document.querySelector('#log');
const debugPanel = document.querySelector('#debugPanel');

let stream = null;
let running = false;
let loopTimer = null;
let receiver = new TransferReassembler();
let seenPackets = new Set();
let lastCompletedSession = null;
let metrics = createMetrics();

function createMetrics() {
  return {
    startedAt: performance.now(),
    captureFrames: 0,
    roiLocks: 0,
    opticalDecodeAttempts: 0,
    opticalDecodes: 0,
    packetCrcFailures: 0,
    acceptedUniquePackets: 0,
    duplicateOpticalFrames: 0,
    lastConfidence: 0,
    lastFinderSeparation: 0,
    lastRotation: 0,
    lastError: '',
  };
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  const row = document.createElement('div');
  row.textContent = `[${time}] ${message}`;
  logHost.prepend(row);
  while (logHost.children.length > 30) logHost.lastElementChild.remove();
}

function setPill(element, text, kind = 'neutral') {
  element.textContent = text;
  element.dataset.kind = kind;
}

function packetKey(packet) {
  return `${packet.sessionId}:${packet.frameType}:${packet.sequence}`;
}

function renderMetrics() {
  const elapsedSeconds = Math.max(0.001, (performance.now() - metrics.startedAt) / 1000);
  const status = receiver.status();
  const usefulBps = status.complete && status.totalBytes !== null
    ? Math.round((status.totalBytes * 8) / elapsedSeconds)
    : 0;

  const values = [
    ['Camera samples', metrics.captureFrames],
    ['Valid frame locks', metrics.roiLocks],
    ['Optical decodes', metrics.opticalDecodes],
    ['Packet CRC fails', metrics.packetCrcFailures],
    ['Unique packets', metrics.acceptedUniquePackets],
    ['Optical duplicates', metrics.duplicateOpticalFrames],
    ['Finder separation', metrics.lastFinderSeparation.toFixed(1)],
    ['Avg confidence', `${(metrics.lastConfidence * 100).toFixed(1)}%`],
    ['Rotation', `${metrics.lastRotation}°`],
    ['Useful rate', usefulBps ? `${usefulBps} bps` : '—'],
  ];

  metricsHost.innerHTML = values
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join('');
}

function resetTransfer(reason = 'manual reset') {
  receiver = new TransferReassembler();
  seenPackets = new Set();
  lastCompletedSession = null;
  metrics = createMetrics();
  output.textContent = 'Waiting for a complete transfer…';
  setPill(packetState, 'No packet yet');
  setPill(transferState, 'Waiting');
  setPill(lockState, running ? 'Align frame' : 'No frame');
  log(`Transfer state reset (${reason}).`);
  renderMetrics();
}

async function startCamera() {
  if (running) return;
  startButton.disabled = true;
  setPill(cameraState, 'Requesting camera…', 'working');
  setPill(lockState, 'Preparing guide…', 'working');

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API is unavailable. Open this page over HTTPS in a modern browser.');
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    video.srcObject = stream;
    await video.play();
    running = true;
    stopButton.disabled = false;
    setPill(cameraState, `${video.videoWidth}×${video.videoHeight} active`, 'good');
    setPill(lockState, 'Align frame', 'working');
    log('Camera started without OpenCV. Align the sender outer white square with the yellow guide.');
    scheduleLoop(0);
  } catch (error) {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
    startButton.disabled = false;
    setPill(cameraState, 'Camera failed', 'bad');
    setPill(lockState, 'No frame');
    metrics.lastError = error.message;
    log(`Camera start failed: ${error.message}`);
    renderMetrics();
  }
}

function stopCamera() {
  running = false;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;
  video.srcObject = null;
  startButton.disabled = false;
  stopButton.disabled = true;
  setPill(cameraState, 'Stopped');
  setPill(lockState, 'No frame');
  log('Camera stopped.');
}

// About four processing attempts per second is enough for the 0.5–2 fps sender
// and keeps CPU use low on ordinary phones.
function scheduleLoop(delay = 240) {
  if (!running) return;
  loopTimer = setTimeout(processFrame, delay);
}

function handleValidPacket(packetBytes, opticalResult) {
  let decoded;
  try {
    decoded = decodePacket(packetBytes);
  } catch (error) {
    metrics.packetCrcFailures += 1;
    if (error instanceof PacketError && error.code === 'CRC_MISMATCH') {
      setPill(packetState, 'CRC rejected', 'bad');
    } else {
      setPill(packetState, 'Invalid packet', 'bad');
    }
    throw error;
  }

  const key = packetKey(decoded);
  if (seenPackets.has(key)) {
    metrics.duplicateOpticalFrames += 1;
    setPill(packetState, `Repeat ${FRAME_TYPE_NAMES[decoded.frameType]} #${decoded.sequence}`);
    return decoded;
  }

  // A valid packet from a new session means the sender started a fresh transfer.
  if (receiver.sessionId !== null && decoded.sessionId !== receiver.sessionId) {
    receiver.reset();
    seenPackets.clear();
    lastCompletedSession = null;
    log(`Detected new session ${decoded.sessionId}; previous session cleared.`);
  }

  const status = receiver.addPacket(packetBytes);
  seenPackets.add(key);
  metrics.acceptedUniquePackets += 1;
  setPill(
    packetState,
    `${FRAME_TYPE_NAMES[decoded.frameType]} #${decoded.sequence} · ${(opticalResult.averageConfidence * 100).toFixed(0)}%`,
    'good',
  );

  if (status.complete) {
    if (lastCompletedSession !== status.sessionId) {
      lastCompletedSession = status.sessionId;
      const data = receiver.getData();
      const text = receiver.getText();
      output.textContent = text;
      setPill(transferState, `Complete · ${data.length} bytes`, 'good');
      log(`Transfer ${status.sessionId} complete: ${data.length} bytes recovered.`);
    }
  } else {
    const expected = status.expectedDataPackets === null ? '?' : status.expectedDataPackets;
    setPill(
      transferState,
      `Session ${status.sessionId} · ${status.receivedDataPackets}/${expected} DATA`,
      'working',
    );
  }

  return decoded;
}

async function processFrame() {
  if (!running || video.readyState < 2) {
    scheduleLoop();
    return;
  }

  try {
    metrics.captureFrames += 1;
    drawVideoFrame(video, sourceCanvas);

    const guide = getCenteredGuideRect(sourceCanvas.width, sourceCanvas.height);
    // Copy the unannotated pixels first; draw the guide only after cropping.
    rectifyGuide(sourceCanvas, rectifiedCanvas, guide);
    extractLogicalRoi(rectifiedCanvas, roiCanvas);
    metrics.opticalDecodeAttempts += 1;

    let locked = false;
    try {
      const opticalResult = decodeRectifiedRoi(roiCanvas);
      metrics.opticalDecodes += 1;
      metrics.lastConfidence = opticalResult.averageConfidence;
      metrics.lastFinderSeparation = opticalResult.finderSeparation;
      metrics.lastRotation = opticalResult.rotation;

      handleValidPacket(opticalResult.packetBytes, opticalResult);
      metrics.roiLocks += 1;
      locked = true;
      metrics.lastError = '';
      setPill(lockState, 'Frame locked', 'good');
    } catch (error) {
      metrics.lastError = error.message;
      setPill(lockState, 'Align frame', 'working');
      if (!String(error.message).includes('CRC')) {
        setPill(packetState, 'Waiting for clean frame');
      }
    }

    drawGuideOverlay(sourceCanvas, guide, locked ? 'locked' : 'align');
  } catch (error) {
    metrics.lastError = error.message;
    setPill(lockState, 'Processing error', 'bad');
    log(`Frame processing error: ${error.message}`);
  }

  renderMetrics();
  scheduleLoop();
}

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopCamera);
resetButton.addEventListener('click', () => resetTransfer());
toggleDebug.addEventListener('change', () => {
  debugPanel.hidden = !toggleDebug.checked;
});

window.addEventListener('beforeunload', stopCamera);
resetTransfer('initial state');
