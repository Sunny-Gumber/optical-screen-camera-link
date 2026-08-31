import { decodePacket, FRAME_TYPE_NAMES, PacketError, TransferReassembler } from '../../packages/protocol/src/index.js';
import { decodeRectifiedRoi } from './decoder.js';
import {
  describeCameraError,
  listVideoInputs,
  openCameraWithFallback,
} from './camera.js';
import {
  detectFrameFiducials,
  drawAutoFiducialOverlay,
  drawVideoFrame,
  extractLogicalRoi,
  rectifyFiducials,
} from './vision.js';

const video = document.querySelector('#camera');
const sourceCanvas = document.querySelector('#sourceCanvas');
const rectifiedCanvas = document.querySelector('#rectifiedCanvas');
const roiCanvas = document.querySelector('#roiCanvas');
const startButton = document.querySelector('#startCamera');
const stopButton = document.querySelector('#stopCamera');
const resetButton = document.querySelector('#resetTransfer');
const refreshCamerasButton = document.querySelector('#refreshCameras');
const cameraSelect = document.querySelector('#cameraSelect');
const cameraError = document.querySelector('#cameraError');
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
let lastDetection = null;
let locatorMisses = 0;

function createMetrics() {
  return {
    startedAt: performance.now(),
    captureFrames: 0,
    locatorDetections: 0,
    roiLocks: 0,
    opticalDecodeAttempts: 0,
    opticalDecodes: 0,
    packetCrcFailures: 0,
    acceptedUniquePackets: 0,
    duplicateOpticalFrames: 0,
    lastLocatorScore: 0,
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

function showCameraError(info = null) {
  if (!info) {
    cameraError.hidden = true;
    cameraError.innerHTML = '';
    return;
  }
  cameraError.hidden = false;
  cameraError.innerHTML = `
    <strong>${info.title}</strong>
    <span>${info.detail}</span>
    <code>${info.technical}</code>
  `;
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
    ['4-locator detects', metrics.locatorDetections],
    ['Valid frame locks', metrics.roiLocks],
    ['Optical decodes', metrics.opticalDecodes],
    ['Packet CRC fails', metrics.packetCrcFailures],
    ['Unique packets', metrics.acceptedUniquePackets],
    ['Locator score', metrics.lastLocatorScore.toFixed(1)],
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
  setPill(lockState, running ? 'Searching 4 locators' : 'No frame', running ? 'working' : 'neutral');
  log(`Transfer state reset (${reason}).`);
  renderMetrics();
}

function clearAutoAlignment() {
  lastDetection = null;
  locatorMisses = 0;
}

function averageCornerDistance(a, b) {
  if (!a?.corners || !b?.corners) return Infinity;
  return a.corners.reduce((sum, point, index) => {
    const other = b.corners[index];
    return sum + Math.hypot(point.x - other.x, point.y - other.y);
  }, 0) / 4;
}

function smoothDetection(previous, next, canvasWidth) {
  if (!previous) return next;
  const movement = averageCornerDistance(previous, next);
  if (movement > Math.max(28, canvasWidth * 0.065)) return next;
  const alpha = 0.42;
  return {
    ...next,
    corners: next.corners.map((point, index) => ({
      x: (previous.corners[index].x * (1 - alpha)) + (point.x * alpha),
      y: (previous.corners[index].y * (1 - alpha)) + (point.y * alpha),
    })),
  };
}

async function refreshCameraList(preferredDeviceId = '') {
  try {
    const devices = await listVideoInputs(navigator.mediaDevices);
    const previous = preferredDeviceId || cameraSelect.value;
    cameraSelect.innerHTML = '';

    if (!devices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No camera detected';
      cameraSelect.append(option);
      cameraSelect.disabled = true;
      return;
    }

    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      cameraSelect.append(option);
    });

    cameraSelect.disabled = false;
    if (previous && devices.some((device) => device.deviceId === previous)) {
      cameraSelect.value = previous;
    }
  } catch (error) {
    log(`Unable to list cameras: ${error.message}`);
  }
}

async function startCamera() {
  if (running) return;
  startButton.disabled = true;
  showCameraError(null);
  setPill(cameraState, 'Requesting camera…', 'working');
  setPill(lockState, 'Starting camera…', 'working');

  try {
    if (!window.isSecureContext) {
      const error = new Error('This page is not in a secure context');
      error.name = 'SecurityError';
      throw error;
    }

    const selectedDeviceId = cameraSelect.value || '';
    const opened = await openCameraWithFallback(
      navigator.mediaDevices,
      selectedDeviceId,
      (label) => {
        setPill(cameraState, `Trying ${label}…`, 'working');
        log(`Trying camera mode: ${label}`);
      },
    );

    stream = opened.stream;
    video.srcObject = stream;
    await video.play();

    running = true;
    stopButton.disabled = false;
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    await refreshCameraList(settings.deviceId || selectedDeviceId);

    clearAutoAlignment();
    setPill(cameraState, `${video.videoWidth}×${video.videoHeight} active`, 'good');
    setPill(lockState, 'Searching 4 locators', 'working');
    showCameraError(null);
    log(`Camera started using ${opened.attempt}. Automatic optical locator detection is active.`);
    scheduleLoop(0);
  } catch (error) {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
    startButton.disabled = false;
    stopButton.disabled = true;

    const info = describeCameraError(error);
    setPill(cameraState, info.title, 'bad');
    setPill(lockState, 'No frame');
    metrics.lastError = info.technical;
    showCameraError(info);
    log(`Camera start failed: ${info.technical}`);
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
  clearAutoAlignment();
  startButton.disabled = false;
  stopButton.disabled = true;
  setPill(cameraState, 'Stopped');
  setPill(lockState, 'No frame');
  log('Camera stopped.');
}

// V1.4 does locator detection plus a perspective warp in plain JavaScript.
// Roughly 3 processing attempts/second keeps ordinary phones responsive.
function scheduleLoop(delay = 320) {
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
      output.textContent = receiver.getText();
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

    const detection = detectFrameFiducials(sourceCanvas);
    if (detection) {
      lastDetection = smoothDetection(lastDetection, detection, sourceCanvas.width);
      locatorMisses = 0;
      metrics.locatorDetections += 1;
      metrics.lastLocatorScore = detection.score;
    } else {
      locatorMisses += 1;
      // Keep a recent lock briefly: the sender data changes, but locator geometry does not.
      if (locatorMisses > 5) lastDetection = null;
    }

    if (!lastDetection) {
      setPill(lockState, 'Searching 4 locators', 'working');
      drawAutoFiducialOverlay(sourceCanvas, null, 'searching');
      renderMetrics();
      scheduleLoop();
      return;
    }

    rectifyFiducials(sourceCanvas, rectifiedCanvas, lastDetection.corners);
    extractLogicalRoi(rectifiedCanvas, roiCanvas);
    metrics.opticalDecodeAttempts += 1;

    let decodedOk = false;
    try {
      const opticalResult = decodeRectifiedRoi(roiCanvas);
      metrics.opticalDecodes += 1;
      metrics.lastConfidence = opticalResult.averageConfidence;
      metrics.lastFinderSeparation = opticalResult.finderSeparation;
      metrics.lastRotation = opticalResult.rotation;

      handleValidPacket(opticalResult.packetBytes, opticalResult);
      metrics.roiLocks += 1;
      decodedOk = true;
      metrics.lastError = '';
      setPill(lockState, 'Auto aligned', 'good');
    } catch (error) {
      metrics.lastError = error.message;
      setPill(lockState, '4 locators found · decoding', 'working');
      if (!String(error.message).includes('CRC')) {
        setPill(packetState, 'Waiting for clean frame');
      }
    }

    drawAutoFiducialOverlay(sourceCanvas, lastDetection, decodedOk ? 'decoded' : 'found');
  } catch (error) {
    metrics.lastError = error.message;
    setPill(lockState, 'Auto-align error', 'bad');
    log(`Frame processing error: ${error.message}`);
  }

  renderMetrics();
  scheduleLoop();
}

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopCamera);
resetButton.addEventListener('click', () => resetTransfer());
refreshCamerasButton.addEventListener('click', () => refreshCameraList());
cameraSelect.addEventListener('change', () => {
  if (running) {
    stopCamera();
    startCamera();
  }
});
toggleDebug.addEventListener('change', () => {
  debugPanel.hidden = !toggleDebug.checked;
});

navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshCameraList());
window.addEventListener('beforeunload', stopCamera);

resetTransfer('initial state');
refreshCameraList();
