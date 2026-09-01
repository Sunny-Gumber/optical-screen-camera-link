import { checkLevelSolved } from '../physics/rayEngine.js';
import { isPieceInsideBounds, polygonsOverlap, piecePolygon } from '../interaction/interaction.js';
import { instantiateLevel, traceLevelRuntime } from './loader.js';

const DEG = Math.PI / 180;
const clone = (value) => JSON.parse(JSON.stringify(value));
const key = (value) => Math.round(value * 1000) / 1000;

function uniquePositions(values) {
  const seen = new Set();
  return values.filter((position) => {
    const id = `${key(position.x)}:${key(position.y)}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function candidatePositions(piece, runtime, gridStep) {
  if (!piece.movable) return [{ x: piece.x, y: piece.y }];
  const values = [{ x: piece.x, y: piece.y }];
  for (let y = gridStep / 2; y < runtime.boardBounds.height; y += gridStep) {
    for (let x = gridStep / 2; x < runtime.boardBounds.width; x += gridStep) {
      if (isPieceInsideBounds(piece, runtime.bounds, { x, y, rotation: piece.rotation })) values.push({ x, y });
    }
  }
  return uniquePositions(values);
}

function candidateRotations(piece) {
  if (!piece.rotatable) return [piece.rotation];
  return Array.from({ length: 24 }, (_, index) => index * 15 * DEG);
}

function pieceCandidates(piece, runtime, gridStep) {
  const positions = candidatePositions(piece, runtime, gridStep);
  const rotations = candidateRotations(piece);
  const candidates = [];
  for (const position of positions) {
    for (const rotation of rotations) {
      if (isPieceInsideBounds(piece, runtime.bounds, { ...position, rotation })) {
        candidates.push({ x: position.x, y: position.y, rotation });
      }
    }
  }
  return candidates;
}

function currentPiecesDoNotOverlap(pieces) {
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      if (pieces[i].collidable === false || pieces[j].collidable === false) continue;
      if (polygonsOverlap(piecePolygon(pieces[i]), piecePolygon(pieces[j]), 1)) return false;
    }
  }
  return true;
}

function solutionSnapshot(runtime) {
  return runtime.pieces
    .filter((piece) => piece.movable || piece.rotatable)
    .map((piece) => ({
      id: piece.id,
      x: Number(piece.x.toFixed(3)),
      y: Number(piece.y.toFixed(3)),
      rotation: Number((piece.rotation / DEG).toFixed(3))
    }));
}

export function estimateSearchSpace(levelInput, { gridStep = 120 } = {}) {
  const runtime = instantiateLevel(levelInput);
  const variablePieces = runtime.pieces.filter((piece) => piece.movable || piece.rotatable);
  const candidateCounts = variablePieces.map((piece) => ({ id: piece.id, count: pieceCandidates(piece, runtime, gridStep).length }));
  const estimatedCombinations = candidateCounts.reduce((product, entry) => product * Math.max(1, entry.count), 1);
  return { estimatedCombinations, candidateCounts, variablePieceCount: variablePieces.length };
}

export function solveLevel(levelInput, {
  gridStep = 120,
  maxCombinations = 100000,
  maxSolutions = 50,
  stopAfterFirst = false
} = {}) {
  const runtime = instantiateLevel(levelInput);
  const variablePieces = runtime.pieces.filter((piece) => piece.movable || piece.rotatable);
  const candidates = variablePieces.map((piece) => pieceCandidates(piece, runtime, gridStep));
  const candidateCounts = variablePieces.map((piece, index) => ({ id: piece.id, count: candidates[index].length }));
  const estimatedCombinations = candidateCounts.reduce((product, entry) => product * Math.max(1, entry.count), 1);
  const warnings = [];
  if (estimatedCombinations > maxCombinations) {
    warnings.push(`Search space ${estimatedCombinations.toLocaleString()} exceeds cap ${maxCombinations.toLocaleString()}; search will stop at the cap.`);
  }

  let checkedCombinations = 0;
  let solutionCount = 0;
  let exampleSolution = null;
  let capped = false;
  let solutionCountCapped = false;

  const original = runtime.pieces.map((piece) => ({ id: piece.id, x: piece.x, y: piece.y, rotation: piece.rotation }));

  const evaluate = () => {
    if (!currentPiecesDoNotOverlap(runtime.pieces)) return false;
    checkedCombinations += 1;
    if (checkedCombinations > maxCombinations) { capped = true; return true; }
    const trace = traceLevelRuntime(runtime);
    if (!checkLevelSolved(trace.statuses)) return false;
    solutionCount += 1;
    if (!exampleSolution) exampleSolution = solutionSnapshot(runtime);
    if (solutionCount >= maxSolutions) {
      solutionCountCapped = true;
      return true;
    }
    return stopAfterFirst;
  };

  const walk = (index) => {
    if (checkedCombinations >= maxCombinations) { capped = true; return true; }
    if (index >= variablePieces.length) return evaluate();
    const piece = variablePieces[index];
    const originalState = { x: piece.x, y: piece.y, rotation: piece.rotation };
    for (const candidate of candidates[index]) {
      piece.x = candidate.x; piece.y = candidate.y; piece.rotation = candidate.rotation;
      if (walk(index + 1)) {
        if (stopAfterFirst || solutionCountCapped || capped) {
          piece.x = originalState.x; piece.y = originalState.y; piece.rotation = originalState.rotation;
          return true;
        }
      }
    }
    piece.x = originalState.x; piece.y = originalState.y; piece.rotation = originalState.rotation;
    return false;
  };

  if (variablePieces.length === 0) evaluate(); else walk(0);
  for (const state of original) {
    const piece = runtime.pieces.find((item) => item.id === state.id);
    if (piece) { piece.x = state.x; piece.y = state.y; piece.rotation = state.rotation; }
  }

  const solvable = solutionCount > 0;
  let constraintQuality = 'unsolved';
  if (solvable) {
    if (solutionCountCapped || solutionCount >= 12) constraintQuality = 'loose';
    else if (solutionCount <= 3) constraintQuality = 'well-constrained';
    else constraintQuality = 'moderate';
  } else if (capped) constraintQuality = 'unknown-capped';

  if (constraintQuality === 'loose') warnings.push('Many solutions found; the puzzle may be under-constrained.');
  if (capped && !solvable) warnings.push('No solution was found before the cap; this is not proof of impossibility.');

  return {
    solvable,
    solutionCount: Math.min(solutionCount, maxSolutions),
    solutionCountLabel: solutionCountCapped ? `${maxSolutions}+` : String(solutionCount),
    exampleSolution: exampleSolution ? clone(exampleSolution) : null,
    checkedCombinations: Math.min(checkedCombinations, maxCombinations),
    estimatedCombinations,
    capped,
    complete: !capped && !solutionCountCapped,
    constraintQuality,
    warnings,
    candidateCounts
  };
}
