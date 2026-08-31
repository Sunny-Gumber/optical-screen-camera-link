export const V1_G16_C16 = Object.freeze({
  id: 'V1-G16-C16-R3',
  modulation: 'C16-R3',
  logicalSize: 256,
  cellSize: 16,
  gridSize: 16,
  calibrationRow: 2,
  dataRowStart: 3,
  dataRowEnd: 13,
  bitsPerSymbol: 4,
  symbolCount: 16,
  repetition: 3,
  dataSymbolCapacity: 58,
  encodedSymbolCapacity: 174,
  physicalDataCellCapacity: 176,
  dataByteCapacity: 29,
  lengthPrefixBytes: 2,
  maxPacketBytes: 27,
  recommendedProtocolPayloadBytes: 13,
});

export const V2_S8_C32_R3 = Object.freeze({
  id: 'V2-S8-C32-R3',
  modulation: 'S8C32-R3',
  logicalSize: 256,
  cellSize: 16,
  gridSize: 16,
  shapeCalibrationRow: 0,
  shapeCalibrationStartX: 3,
  profileSignatureRow: 1,
  profileSignatureStartX: 5,
  profileSignatureBits: Object.freeze([1, 0, 1, 0, 0, 1]),
  colorCalibrationRows: Object.freeze([2, 3]),
  dataRowStart: 4,
  dataRowEnd: 13,
  shapeCount: 8,
  colorCount: 32,
  bitsPerPhysicalCell: 8,
  repetition: 3,
  physicalDataCellCapacity: 160,
  dataByteCapacity: 53,
  encodedByteCapacity: 159,
  lengthPrefixBytes: 2,
  maxPacketBytes: 51,
  recommendedProtocolPayloadBytes: 37,
});

export const V21_S8_C16_R3 = Object.freeze({
  id: 'V2.1-S8-C16-R3',
  modulation: 'S8C16-R3',
  logicalSize: 256,
  cellSize: 16,
  gridSize: 16,
  shapeCalibrationRow: 0,
  shapeCalibrationStartX: 3,
  profileSignatureRow: 1,
  profileSignatureStartX: 5,
  profileSignatureBits: Object.freeze([1, 1, 0, 1, 0, 0]),
  colorCalibrationRows: Object.freeze([2]),
  dataRowStart: 3,
  dataRowEnd: 13,
  shapeCount: 8,
  colorCount: 16,
  bitsPerPhysicalCell: 7,
  repetition: 3,
  physicalDataCellCapacity: 176,
  logicalSymbolCapacity: 58,
  encodedSymbolCapacity: 174,
  dataBitCapacity: 406,
  dataByteCapacity: 50,
  lengthPrefixBytes: 2,
  maxPacketBytes: 48,
  recommendedProtocolPayloadBytes: 34,
});

export const V22_S8_C8_B4_R3 = Object.freeze({
  id: 'V2.2-S8-C8-B4-R3',
  modulation: 'S8C8B4-R3',
  logicalSize: 256,
  cellSize: 16,
  gridSize: 16,
  shapeCalibrationRow: 0,
  shapeCalibrationStartX: 3,
  profileSignatureRow: 1,
  profileSignatureStartX: 5,
  profileSignatureBits: Object.freeze([0, 1, 1, 0, 1, 1]),
  channelCalibrationRow: 2,
  colorCalibrationStartX: 0,
  backgroundCalibrationStartX: 8,
  dataRowStart: 3,
  dataRowEnd: 13,
  shapeCount: 8,
  colorCount: 8,
  backgroundCount: 4,
  bitsPerPhysicalCell: 8,
  repetition: 3,
  physicalDataCellCapacity: 176,
  dataByteCapacity: 58,
  encodedByteCapacity: 174,
  lengthPrefixBytes: 2,
  maxPacketBytes: 56,
  recommendedProtocolPayloadBytes: 42,
});

// V3 changes the strategy: many simple cells rather than many states per cell.
// The complete frame is exactly 3x the V1 geometry (912px vs 304px), allowing
// the existing low-resolution locator path to acquire it before a native/high-
// resolution second warp is used for data decoding.
export const V3_G64_S4_C4_RS = Object.freeze({
  id: 'V3-G64-S4-C4-RS15-11',
  modulation: 'S4C4-RS15-11',
  version: 30,
  totalSize: 912,
  quietZone: 72,
  fiducialScale: 3,
  logicalSize: 768,
  cellSize: 12,
  gridSize: 64,
  timingBorder: true,
  finderSizeCells: 2,
  finderOrigins: Object.freeze([
    Object.freeze({ corner: 'TL', x: 1, y: 1 }),
    Object.freeze({ corner: 'TR', x: 61, y: 1 }),
    Object.freeze({ corner: 'BL', x: 1, y: 61 }),
    Object.freeze({ corner: 'BR', x: 61, y: 61 }),
  ]),
  calibrationRow: 3,
  colorCalibrationStartX: 4,
  shapeCalibrationStartX: 9,
  profileSignatureStartX: 14,
  profileSignatureBits: Object.freeze([1, 0, 1, 1, 0, 0, 1, 0]),
  shapeCount: 4,
  colorCount: 4,
  bitsPerCell: 4,
  rsN: 15,
  rsK: 11,
  rsParity: 4,
  rsCorrectableSymbols: 2,
  rsCodewordCount: 254,
  encodedSymbolCapacity: 3810,
  dataNibbleCapacity: 2794,
  dataByteCapacity: 1397,
  lengthPrefixBytes: 2,
  maxPacketBytes: 1395,
  // Reliability-first first target. The profile can carry more, but 1024-byte
  // chunks avoid requiring every RS block to decode during early tests.
  recommendedProtocolPayloadBytes: 1024,
});

export function getDataCellCoordinates(profile = V1_G16_C16) {
  const cells = [];
  for (let y = profile.dataRowStart; y <= profile.dataRowEnd; y += 1) {
    for (let x = 0; x < profile.gridSize; x += 1) cells.push({ x, y });
  }
  return cells;
}

function v3ReservedCell(profile, x, y) {
  if (x === 0 || y === 0 || x === profile.gridSize - 1 || y === profile.gridSize - 1) return true;

  for (const finder of profile.finderOrigins) {
    if (x >= finder.x && x < finder.x + profile.finderSizeCells
      && y >= finder.y && y < finder.y + profile.finderSizeCells) return true;
  }

  if (y === profile.calibrationRow) {
    if (x >= profile.colorCalibrationStartX && x < profile.colorCalibrationStartX + profile.colorCount) return true;
    if (x >= profile.shapeCalibrationStartX && x < profile.shapeCalibrationStartX + profile.shapeCount) return true;
    if (x >= profile.profileSignatureStartX
      && x < profile.profileSignatureStartX + profile.profileSignatureBits.length) return true;
  }
  return false;
}

export function getV3DataCellCoordinates(profile = V3_G64_S4_C4_RS) {
  const cells = [];
  for (let y = 0; y < profile.gridSize; y += 1) {
    for (let x = 0; x < profile.gridSize; x += 1) {
      if (!v3ReservedCell(profile, x, y)) cells.push({ x, y });
    }
  }
  return cells.slice(0, profile.encodedSymbolCapacity);
}
