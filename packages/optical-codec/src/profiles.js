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

  // V1.5 reliability mode: every logical C16 symbol is transmitted three
  // times in spatially separated regions of the frame. 58 logical symbols
  // become 174 physical symbols, leaving two data-row cells unused.
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

  // Row 0 contains eight live shape references; row 1 contains a profile
  // signature; rows 2-3 contain all 32 live colour references.
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

  // 160 physical data cells. Three spatially separated copies carry each
  // logical byte, leaving one spare cell. Shape and colour vote separately.
  repetition: 3,
  physicalDataCellCapacity: 160,
  dataByteCapacity: 53,
  encodedByteCapacity: 159,
  lengthPrefixBytes: 2,
  maxPacketBytes: 51,
  recommendedProtocolPayloadBytes: 37,
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
