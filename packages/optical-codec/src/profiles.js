export const V1_G16_C16 = Object.freeze({
  id: 'V1-G16-C16',
  logicalSize: 256,
  cellSize: 16,
  gridSize: 16,
  calibrationRow: 2,
  dataRowStart: 3,
  dataRowEnd: 13,
  bitsPerSymbol: 4,
  symbolCount: 16,
  dataSymbolCapacity: 176,
  dataByteCapacity: 88,
  lengthPrefixBytes: 2,
  maxPacketBytes: 86,
  recommendedProtocolPayloadBytes: 72,
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
