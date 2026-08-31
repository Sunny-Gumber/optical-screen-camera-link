import { decodePacket, FRAME_TYPE_NAMES, PacketError, TransferReassembler } from '../../packages/protocol/src/index.js';
import { V3_G64_S4_C4_RS } from '../../packages/optical-codec/src/profiles.js';
import {
  describeCameraError,
  listVideoInputs,
  openCameraWithFallback,
} from '../receiver-web/camera.js';
import {
  drawVideoFrame,
  drawAutoFiducialOverlay,
  extractLogicalRoi,
  rectifyFiducials,
} from '../receiver-web/vision.js';
import {
  estimateV3CameraPixelsPerCell,
  rectifyV3LogicalRoi,
  trackOrAcquireV3Fiducials,
} from './vision-v3.js';
import { detectV3Coarse, decodeV3Roi } from './v3-decoder.js';

const video = document.querySelector('#camera');
const sourceCanvas = document.querySelector('#sourceCanvas');
const highSourceCanvas = document.querySelector('#highSourceCanvas');
const coarseRectified = document.querySelector('#coarseRectified');
const coarseRoi = document.querySelector('#coarseRoi');
const v3Roi = document.querySelector('#v3Roi');
const startButton = document.querySelector('#startCamera');
const stopButton = document.querySelector('#stopCamera');
const resetButton = document.querySelector('#resetTransfer');
const refreshButton = document.querySelector('#refreshCameras');
const cameraSelect = document.querySelector('#cameraSelect');
const toggleDebug = document.querySelector('#toggleDebug');
const debugPanel = document.querySelector('#debugPanel');
const cameraState = document.querySelector('#cameraState');
const trackingState = document.querySelector('#trackingState');
const decodeState = document.querySelector('#decodeState');
const transferState = document.querySelector('#transferState');
const cameraError = document.querySelector('#cameraError');
const metricsHost = document.querySelector('#metrics');
const output = document.querySelector('#output');
const logHost = document.querySelector('#log');

let stream = null;
let running = false;
let loopTimer = null;
let lastDetection = null;
let detectorMisses = 0;
let coarseMisses = 0;
let receiver = new TransferReassembler();
let seenPackets = new Set();
let lastCompletedSession = null;
let metrics = createMetrics();

function createMetrics() {
  return {
    captureFrames: 0,
    globalAcquires: 0,
    trackedFrames: 0,
    detectorMisses: 0,
    coarseLocks: 0,
    opticalAttempts: 0,
    opticalDecodes: 0,
    rsRejects: 0,
    protocolRejects: 0,
    crcRejects: 0,
    acceptedUniquePackets: 0,
    duplicates: 0,
    pixelsPerCell: 0,
    timingSeparation: 0,
    signatureSeparation: 0,
    phaseX: 0,
    phaseY: 0,
    rotation: 0,
    colorConfidence: 0,
    shapeConfidence: 0,
    averageConfidence: 0,
    lastRsCorrected: 0,
    totalRsCorrected: 0,
    lastRsBlocks: 0,
    lastRsFailedBlock: null,
    firstAcceptedAt: null,
    completedAt: null,
    lastError: '',
  };
}

function log(message) {
  const row = document.createElement('div');
  row.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logHost.prepend(row);
  while (logHost.children.length > 35) logHost.lastElementChild.remove();
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
  cameraError.innerHTML = `<strong>${info.title}</strong><span>${info.detail}</span><code>${info.technical}</code>`;
}

function renderMetrics() {
  const status = receiver.status();
  let usefulBps = 0;
  if (status.complete && status.totalBytes !== null && metrics.firstAcceptedAt !== null) {
    const end = metrics.completedAt ?? performance.now();
    const seconds = Math.max(0.001, (end - metrics.firstAcceptedAt) / 1000);
    usefulBps = Math.round((status.totalBytes * 8) / seconds);
  }
  const values = [
    ['Profile', V3_G64_S4_C4_RS.id],
    ['Camera samples', metrics.captureFrames],
    ['Global acquires', metrics.globalAcquires],
    ['Locally tracked', metrics.trackedFrames],
    ['Tracker misses', metrics.detectorMisses],
    ['V3 coarse locks', metrics.coarseLocks],
    ['Camera px / cell', metrics.pixelsPerCell ? metrics.pixelsPerCell.toFixed(1) : '—'],
    ['Optical attempts', metrics.opticalAttempts],
    ['Optical decodes', metrics.opticalDecodes],
    ['RS frame rejects', metrics.rsRejects],
    ['Protocol rejects', metrics.protocolRejects],
    ['CRC rejects', metrics.crcRejects],
    ['Unique packets', metrics.acceptedUniquePackets],
    ['Timing contrast', metrics.timingSeparation.toFixed(1)],
    ['Signature contrast', metrics.signatureSeparation.toFixed(1)],
    ['Fine phase', `${metrics.phaseX}, ${metrics.phaseY}px`],
    ['Shape confidence', `${(metrics.shapeConfidence * 100).toFixed(1)}%`],
    ['Colour confidence', `${(metrics.colorConfidence * 100).toFixed(1)}%`],
    ['Avg confidence', `${(metrics.averageConfidence * 100).toFixed(1)}%`],
    ['RS corrected / frame', metrics.lastRsCorrected],
    ['RS corrected total', metrics.totalRsCorrected],
    ['RS blocks decoded', metrics.lastRsBlocks],
    ['Failed RS block', metrics.lastRsFailedBlock ?? '—'],
    ['Rotation', `${metrics.rotation}°`],
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
  const preserved = {
    captureFrames: metrics.captureFrames,
    globalAcquires: metrics.globalAcquires,
    trackedFrames: metrics.trackedFrames,
    detectorMisses: metrics.detectorMisses,
  };
  metrics = createMetrics();
  Object.assign(metrics, preserved);
  output.textContent = 'Waiting for a complete V3 transfer…';
  setPill(decodeState, 'No V3 packet yet');
  setPill(transferState, 'Waiting');
  log(`Transfer reset (${reason}).`);
  renderMetrics();
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
    if (previous && devices.some((device) => device.deviceId === previous)) cameraSelect.value = previous;
  } catch (error) {
    log(`Unable to list cameras: ${error.message}`);
  }
}

async function startCamera() {
  if (running) return;
  startButton.disabled = true;
  showCameraError(null);
  setPill(cameraState, 'Requesting camera…', 'working');
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
      (label) => setPill(cameraState, `Trying ${label}…`, 'working'),
    );
    stream = opened.stream;
    video.srcObject = stream;
    await video.play();
    running = true;
    stopButton.disabled = false;
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    await refreshCameraList(settings.deviceId || selectedDeviceId);
    lastDetection = null;
    detectorMisses = 0;
    coarseMisses = 0;
    setPill(cameraState, `${video.videoWidth}×${video.videoHeight} active`, 'good');
    setPill(trackingState, 'Acquiring 4 locators', 'working');
    log(`V3 camera started via ${opened.attempt}; native-resolution decoding enabled.`);
    scheduleLoop(0);
  } catch (error) {
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    video.srcObject = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    const info = describeCameraError(error);
    setPill(cameraState, info.title, 'bad');
    showCameraError(info);
    log(`Camera failed: ${info.technical}`);
  }
}

function stopCamera() {
  running = false;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  video.srcObject = null;
  lastDetection = null;
  startButton.disabled = false;
  stopButton.disabled = true;
  setPill(cameraState, 'Stopped');
  setPill(trackingState, 'No frame');
  log('Camera stopped.');
}

function scheduleLoop(delay = 650) {
  if (!running) return;
  loopTimer = setTimeout(processFrame, delay);
}

function packetKey(packet) {
  return `${packet.sessionId}:${packet.frameType}:${packet.sequence}`;
}

function acceptProtocolPacket(packetBytes, opticalResult) {
  let decoded;
  try {
    decoded = decodePacket(packetBytes);
  } catch (error) {
    metrics.protocolRejects += 1;
    if (error instanceof PacketError && error.code === 'CRC_MISMATCH') metrics.crcRejects += 1;
    throw error;
  }

  const key = packetKey(decoded);
  if (seenPackets.has(key)) {
    metrics.duplicates += 1;
    setPill(decodeState, `Repeat ${FRAME_TYPE_NAMES[decoded.frameType]} #${decoded.sequence}`);
    return;
  }

  if (receiver.sessionId !== null && receiver.sessionId !== decoded.sessionId) {
    receiver.reset();
    seenPackets.clear();
    lastCompletedSession = null;
    metrics.firstAcceptedAt = null;
    metrics.completedAt = null;
    log(`New session ${decoded.sessionId}; previous incomplete session cleared.`);
  }

  if (metrics.firstAcceptedAt === null) metrics.firstAcceptedAt = performance.now();
  const status = receiver.addPacket(packetBytes);
  seenPackets.add(key);
  metrics.acceptedUniquePackets += 1;
  setPill(
    decodeState,
    `${FRAME_TYPE_NAMES[decoded.frameType]} #${decoded.sequence} · RS fixed ${opticalResult.correctedSymbols}`,
    'good',
  );

  if (status.complete) {
    if (lastCompletedSession !== status.sessionId) {
      lastCompletedSession = status.sessionId;
      metrics.completedAt = performance.now();
      const data = receiver.getData();
      output.textContent = receiver.getText();
      setPill(transferState, `Complete · ${data.length} bytes`, 'good');
      log(`V3 transfer ${status.sessionId} complete: ${data.length} bytes.`);
    }
  } else {
    const expected = status.expectedDataPackets === null ? '?' : status.expectedDataPackets;
    setPill(transferState, `Session ${status.sessionId} · ${status.receivedDataPackets}/${expected} DATA`, 'working');
  }
}

async function processFrame() {
  if (!running || video.readyState < 2) {
    scheduleLoop();
    return;
  }

  try {
    metrics.captureFrames += 1;
    drawVideoFrame(video, sourceCanvas);
    const detection = trackOrAcquireV3Fiducials(sourceCanvas, lastDetection);
    if (!detection) {
      detectorMisses += 1;
      metrics.detectorMisses += 1;
      if (detectorMisses >= 3) lastDetection = null;
      setPill(trackingState, 'Searching 4 locators', 'working');
      drawAutoFiducialOverlay(sourceCanvas, null, 'searching');
      renderMetrics();
      scheduleLoop();
      return;
    }

    detectorMisses = 0;
    lastDetection = detection;
    if (detection.mode === 'tracked') {
      metrics.trackedFrames += 1;
      setPill(trackingState, '4 locators tracked', 'good');
    } else {
      metrics.globalAcquires += 1;
      setPill(trackingState, '4 locators acquired', 'working');
    }

    // Cheap canonical 304/256 warp first. V3 geometry is exactly 3x V1, so
    // this coarse image is enough to validate timing/signature before the
    // expensive native-resolution warp.
    rectifyFiducials(sourceCanvas, coarseRectified, detection.corners);
    extractLogicalRoi(coarseRectified, coarseRoi);
    const probe = detectV3Coarse(coarseRoi);
    if (!probe.isV3) {
      coarseMisses += 1;
      if (coarseMisses >= 3) lastDetection = null;
      setPill(decodeState, 'V3 timing/signature not clean', 'working');
      drawAutoFiducialOverlay(sourceCanvas, detection, 'found');
      metrics.rotation = probe.rotation;
      metrics.timingSeparation = probe.timingSeparation;
      metrics.signatureSeparation = probe.signatureSeparation;
      renderMetrics();
      scheduleLoop();
      return;
    }

    coarseMisses = 0;
    metrics.coarseLocks += 1;
    metrics.rotation = probe.rotation;
    metrics.pixelsPerCell = estimateV3CameraPixelsPerCell(video, sourceCanvas, detection);
    if (metrics.pixelsPerCell < 6) setPill(trackingState, `Too far · ${metrics.pixelsPerCell.toFixed(1)} px/cell`, 'working');

    rectifyV3LogicalRoi(video, sourceCanvas, detection, highSourceCanvas, v3Roi);
    metrics.opticalAttempts += 1;

    let decodedOk = false;
    try {
      const optical = decodeV3Roi(v3Roi, probe.rotation);
      metrics.opticalDecodes += 1;
      metrics.timingSeparation = optical.timingSeparation;
      metrics.signatureSeparation = optical.signatureSeparation;
      metrics.phaseX = optical.phaseX;
      metrics.phaseY = optical.phaseY;
      metrics.colorConfidence = optical.averageColorConfidence;
      metrics.shapeConfidence = optical.averageShapeConfidence;
      metrics.averageConfidence = optical.averageConfidence;
      metrics.lastRsCorrected = optical.correctedSymbols;
      metrics.totalRsCorrected += optical.correctedSymbols;
      metrics.lastRsBlocks = optical.rsBlocksDecoded;
      metrics.lastRsFailedBlock = null;
      acceptProtocolPacket(optical.packetBytes, optical);
      metrics.lastError = '';
      decodedOk = true;
    } catch (error) {
      metrics.lastError = error.message;
      if (error.code === 'RS16_UNCORRECTABLE') {
        metrics.rsRejects += 1;
        metrics.lastRsFailedBlock = error.blockIndex ?? 'unknown';
        setPill(decodeState, `RS block ${error.blockIndex ?? '?'} uncorrectable`, 'bad');
      } else if (error instanceof PacketError) {
        setPill(decodeState, error.code === 'CRC_MISMATCH' ? 'Protocol CRC rejected' : `${error.code} rejected`, 'bad');
      } else {
        setPill(decodeState, 'Waiting for cleaner V3 frame', 'working');
      }
    }

    drawAutoFiducialOverlay(sourceCanvas, detection, decodedOk ? 'decoded' : 'found');
  } catch (error) {
    metrics.lastError = error.message;
    setPill(decodeState, 'V3 frame-processing error', 'bad');
    log(`V3 processing error: ${error.message}`);
  }

  renderMetrics();
  scheduleLoop();
}

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopCamera);
resetButton.addEventListener('click', () => resetTransfer());
refreshButton.addEventListener('click', () => refreshCameraList());
cameraSelect.addEventListener('change', () => {
  if (running) {
    stopCamera();
    startCamera();
  }
});
toggleDebug.addEventListener('change', () => { debugPanel.hidden = !toggleDebug.checked; });
navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshCameraList());
window.addEventListener('beforeunload', stopCamera);

resetTransfer('initial state');
refreshCameraList();
