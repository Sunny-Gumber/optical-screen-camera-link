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

// Reliability-first hybrid profile. 8 shapes provide 3 bits and 16 colours
// provide 4 bits, so each logical symbol carries 7 bits. Only one colour
// calibration row is required, allowing row 3 to become payload again.
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

export function getDataCellCoordinates(profile = V1_G16_C16) {
  const cells = [];
  for (let y = profile.dataRowStart; y <= profile.dataRowEnd; y += 1) {
    for (let x = 0; x < profile.gridSize; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}
