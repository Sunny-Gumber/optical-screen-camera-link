export const V1_G16_C16 = Object.freeze({
  id: 'V1-G16-C16-R3',
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

export function getDataCellCoordinates(profile = V1_G16_C16) {
  const cells = [];
  for (let y = profile.dataRowStart; y <= profile.dataRowEnd; y += 1) {
    for (let x = 0; x < profile.gridSize; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}
