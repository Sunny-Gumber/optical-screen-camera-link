import { getDataCellCoordinates, V1_G16_C16 } from './profiles.js';
import { bytesToC16Symbols, c16SymbolsToBytes } from './symbol-codec.js';

const FINDER_PATTERNS = Object.freeze({
  TL: [[1, 1], [1, 0]],
  TR: [[1, 0], [1, 1]],
  BL: [[1, 1], [0, 1]],
  BR: [[0, 1], [1, 1]],
});

function emptyCells(profile) {
  return Array.from({ length: profile.gridSize }, (_, y) =>
    Array.from({ length: profile.gridSize }, (_, x) => ({
      x,
      y,
      kind: 'guard',
    })),
  );
}

function placeFinder(cells, corner, x0, y0) {
  const pattern = FINDER_PATTERNS[corner];
  for (let dy = 0; dy < 2; dy += 1) {
    for (let dx = 0; dx < 2; dx += 1) {
      cells[y0 + dy][x0 + dx] = {
        x: x0 + dx,
        y: y0 + dy,
        kind: 'finder',
        corner,
        dark: pattern[dy][dx] === 1,
      };
    }
  }
}

export function encodeOpticalFrame(packetBytes, profile = V1_G16_C16) {
  if (!(packetBytes instanceof Uint8Array)) {
    throw new TypeError('encodeOpticalFrame expects packet bytes as Uint8Array');
  }
  if (packetBytes.length > profile.maxPacketBytes) {
    throw new RangeError(
      `Packet is ${packetBytes.length} bytes; ${profile.id} allows at most ${profile.maxPacketBytes}`,
    );
  }

  const envelope = new Uint8Array(profile.dataByteCapacity);
  const view = new DataView(envelope.buffer);
  view.setUint16(0, packetBytes.length, false);
  envelope.set(packetBytes, profile.lengthPrefixBytes);

  const symbols = bytesToC16Symbols(envelope);
  if (symbols.length !== profile.dataSymbolCapacity) {
    throw new Error('Internal profile capacity mismatch');
  }

  const cells = emptyCells(profile);
  const last = profile.gridSize - 1;
  placeFinder(cells, 'TL', 0, 0);
  placeFinder(cells, 'TR', last - 1, 0);
  placeFinder(cells, 'BL', 0, last - 1);
  placeFinder(cells, 'BR', last - 1, last - 1);

  // One known sample of every C16 symbol is emitted in every frame.
  for (let x = 0; x < profile.gridSize; x += 1) {
    cells[profile.calibrationRow][x] = {
      x,
      y: profile.calibrationRow,
      kind: 'calibration',
      symbol: x,
    };
  }

  const dataCoordinates = getDataCellCoordinates(profile);
  dataCoordinates.forEach(({ x, y }, index) => {
    cells[y][x] = {
      x,
      y,
      kind: 'data',
      symbol: symbols[index],
      symbolIndex: index,
    };
  });

  return {
    version: 1,
    profileId: profile.id,
    logicalSize: profile.logicalSize,
    cellSize: profile.cellSize,
    gridSize: profile.gridSize,
    packetLength: packetBytes.length,
    cells,
  };
}

/**
 * Ideal decoder used for codec tests before camera/image processing exists.
 * It reads already-classified symbols from the frame object.
 */
export function decodeOpticalFrame(frame, profile = V1_G16_C16) {
  if (!frame || frame.profileId !== profile.id) {
    throw new Error(`Expected optical profile ${profile.id}`);
  }

  const symbols = new Uint8Array(profile.dataSymbolCapacity);
  const dataCoordinates = getDataCellCoordinates(profile);
  dataCoordinates.forEach(({ x, y }, index) => {
    const cell = frame.cells?.[y]?.[x];
    if (!cell || cell.kind !== 'data' || !Number.isInteger(cell.symbol)) {
      throw new Error(`Missing classified data symbol at cell ${x},${y}`);
    }
    symbols[index] = cell.symbol;
  });

  const envelope = c16SymbolsToBytes(symbols);
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const packetLength = view.getUint16(0, false);
  if (packetLength > profile.maxPacketBytes) {
    throw new Error(`Decoded packet length ${packetLength} exceeds profile capacity`);
  }

  return envelope.slice(profile.lengthPrefixBytes, profile.lengthPrefixBytes + packetLength);
}
