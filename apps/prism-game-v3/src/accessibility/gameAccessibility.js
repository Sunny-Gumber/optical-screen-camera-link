import './gameAccessibility.css';
import { keyboardIntent } from './accessibility.js';
import { rotationHandlePoint } from '../interaction/interaction.js';
import { runtimePieceFromSchema } from '../levels/loader.js';

const canvas = document.querySelector('#gameCanvas');
const playScreen = document.querySelector('#playScreen');
const levelTitle = document.querySelector('#levelTitle');
const helpButton = document.querySelector('#keyboardHelpButton');
const helpPanel = document.querySelector('#keyboardHelp');
const motionToggle = document.querySelector('#reduceMotionToggle');
const status = document.querySelector('#accessibilityStatus');
const resetButton = document.querySelector('#resetLevel');
const levelsButton = document.querySelector('#backToLevels');

let entries = [];
let activeEntry = null;
let definition = null;
let keyboardPieces = [];
let selectedIndex = 0;
let loadingToken = 0;
const POINTER_ID = 777;
const DEG = Math.PI / 180;

function announce(message) {
  if (!status) return;
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = message; });
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* session-only preference */ }
}

function setReducedMotion(enabled) {
  document.body.classList.toggle('reduce-motion', enabled);
  if (motionToggle) motionToggle.checked = enabled;
  safeSet('prismlab_reduce_motion', enabled ? '1' : '0');
  announce(enabled ? 'Reduced motion enabled.' : 'Reduced motion disabled.');
}

const savedMotion = safeGet('prismlab_reduce_motion');
const systemReduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
setReducedMotion(savedMotion == null ? systemReduced : savedMotion === '1');
motionToggle?.addEventListener('change', () => setReducedMotion(motionToggle.checked));

helpButton?.addEventListener('click', () => {
  const hidden = helpPanel?.classList.toggle('hidden') ?? true;
  helpButton.setAttribute('aria-expanded', String(!hidden));
  if (!hidden) helpPanel?.focus?.();
});

function boardToClient(point) {
  const rect = canvas.getBoundingClientRect();
  const width = definition?.boardBounds?.width ?? canvas.width;
  const height = definition?.boardBounds?.height ?? canvas.height;
  return {
    x: rect.left + point.x / width * rect.width,
    y: rect.top + point.y / height * rect.height
  };
}

function emitPointer(type, point, buttons = 1) {
  if (!canvas || typeof PointerEvent === 'undefined') return;
  const client = boardToClient(point);
  canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : buttons,
    clientX: client.x,
    clientY: client.y
  }));
}

function selectedPiece() {
  return keyboardPieces[selectedIndex] ?? null;
}

function selectPiece(piece = selectedPiece()) {
  if (!piece) return;
  emitPointer('pointerdown', { x: piece.x, y: piece.y });
  emitPointer('pointerup', { x: piece.x, y: piece.y }, 0);
  announce(`Selected ${piece.type} ${piece.id}. Arrow keys move. Q and E rotate.`);
}

function cycleSelection(delta) {
  if (!keyboardPieces.length) return;
  selectedIndex = (selectedIndex + delta + keyboardPieces.length) % keyboardPieces.length;
  selectPiece();
}

function moveSelected(dx, dy) {
  const piece = selectedPiece();
  if (!piece?.movable) {
    announce(piece ? `${piece.type} ${piece.id} cannot move.` : 'No movable optic selected.');
    return;
  }
  const width = definition.boardBounds.width;
  const height = definition.boardBounds.height;
  const target = {
    x: Math.max(0, Math.min(width, piece.x + dx)),
    y: Math.max(0, Math.min(height, piece.y + dy))
  };
  emitPointer('pointerdown', { x: piece.x, y: piece.y });
  emitPointer('pointermove', target);
  emitPointer('pointerup', target, 0);
  piece.x = target.x;
  piece.y = target.y;
  announce(`${piece.type} ${piece.id}: x ${Math.round(piece.x)}, y ${Math.round(piece.y)}.`);
}

function rotateSelected(degrees) {
  const piece = selectedPiece();
  if (!piece?.rotatable) {
    announce(piece ? `${piece.type} ${piece.id} cannot rotate.` : 'No rotatable optic selected.');
    return;
  }
  selectPiece(piece);
  const handle = rotationHandlePoint(piece);
  emitPointer('pointerdown', { x: handle.x, y: handle.y });
  const desired = (piece.rotation ?? 0) + degrees * DEG;
  const pointerAngle = desired - Math.PI / 2;
  const target = {
    x: piece.x + Math.cos(pointerAngle) * handle.radius,
    y: piece.y + Math.sin(pointerAngle) * handle.radius
  };
  emitPointer('pointermove', target);
  emitPointer('pointerup', target, 0);
  piece.rotation = desired;
  announce(`${piece.type} ${piece.id} rotated ${degrees > 0 ? 'clockwise' : 'counter-clockwise'} 15 degrees.`);
}

async function loadKeyboardLevel(levelId) {
  const entry = entries.find((item) => item.id === levelId);
  if (!entry) return;
  const token = ++loadingToken;
  try {
    const response = await fetch(`./levels/${entry.file}`, { cache: 'no-store' });
    if (!response.ok) return;
    const nextDefinition = await response.json();
    if (token !== loadingToken) return;
    activeEntry = entry;
    definition = nextDefinition;
    keyboardPieces = definition.pieces.map(runtimePieceFromSchema).filter((piece) => piece.movable || piece.rotatable);
    selectedIndex = 0;
    canvas?.setAttribute('aria-label', `${entry.name} optics puzzle board. ${keyboardPieces.length} interactive optics. Use left and right square brackets to select, arrow keys to move, Q and E to rotate.`);
    if (document.activeElement === canvas) selectPiece();
  } catch { /* main game displays load failures */ }
}

function syncFromVisibleTitle() {
  const title = levelTitle?.textContent?.trim();
  if (!title || playScreen?.classList.contains('hidden')) return;
  const entry = entries.find((item) => item.name === title);
  if (entry && entry.id !== activeEntry?.id) loadKeyboardLevel(entry.id);
}

canvas?.addEventListener('focus', () => {
  syncFromVisibleTitle();
  if (keyboardPieces.length) selectPiece();
  else announce('Puzzle board focused. Open a level to use keyboard optics controls.');
});

canvas?.addEventListener('keydown', (event) => {
  const intent = keyboardIntent(event);
  if (!intent) return;
  event.preventDefault();
  if (intent.type === 'move') moveSelected(intent.dx, intent.dy);
  if (intent.type === 'rotate') rotateSelected(intent.degrees);
  if (intent.type === 'cycle') cycleSelection(intent.delta);
  if (intent.type === 'reset') resetButton?.click();
  if (intent.type === 'levels') levelsButton?.click();
});

resetButton?.addEventListener('click', () => {
  const id = activeEntry?.id;
  if (id) setTimeout(() => loadKeyboardLevel(id), 0);
});

new MutationObserver(syncFromVisibleTitle).observe(levelTitle ?? document.body, {
  childList: true,
  characterData: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class']
});

(async () => {
  try {
    const response = await fetch('./levels/index.json', { cache: 'no-store' });
    const manifest = await response.json();
    entries = (manifest.chapters ?? []).flatMap((chapter) => chapter.levels ?? []);
    syncFromVisibleTitle();
  } catch { announce('Keyboard helper could not load level metadata. Pointer controls remain available.'); }
})();
