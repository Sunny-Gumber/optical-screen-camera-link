import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V3_G64_S4_C4_RS,
  encodeV3Frame,
  decodeV3Frame,
  getV3DataCellCoordinates,
} from '../src/index.js';
import { splitV3Nibble } from '../../constellation/src/v3.js';

function makeBytes(length) {
  const bytes = new Uint8Array(length);
  let state = 0x12345678;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xFF;
  }
  return bytes;
}

test('V3 data coordinate count matches RS interleaved capacity', () => {
  assert.equal(getV3DataCellCoordinates(V3_G64_S4_C4_RS).length, 3810);
});

test('V3 round-trips a 1KB protocol-sized packet through RS frame encoding', () => {
  const packet = makeBytes(1038);
  const frame = encodeV3Frame(packet);
  const decoded = decodeV3Frame(frame);
  assert.deepEqual([...decoded.packetBytes], [...packet]);
  assert.equal(decoded.correctedSymbols, 0);
});

test('V3 RS interleaving corrects two damaged optical cells in one codeword', () => {
  const packet = makeBytes(600);
  const frame = encodeV3Frame(packet);
  const coordinates = getV3DataCellCoordinates(V3_G64_S4_C4_RS);
  const block = 5;
  const physicalIndexes = [block, V3_G64_S4_C4_RS.rsCodewordCount + block];

  for (const [errorIndex, physicalIndex] of physicalIndexes.entries()) {
    const { x, y } = coordinates[physicalIndex];
    const cell = frame.cells[y][x];
    const damaged = cell.value ^ (errorIndex === 0 ? 0x03 : 0x0C);
    const parts = splitV3Nibble(damaged);
    Object.assign(cell, { value: damaged, ...parts });
  }

  const decoded = decodeV3Frame(frame);
  assert.deepEqual([...decoded.packetBytes], [...packet]);
  assert.ok(decoded.correctedSymbols >= 2);
});

test('V3 maximum packet capacity fits the fixed RS envelope', () => {
  const packet = makeBytes(V3_G64_S4_C4_RS.maxPacketBytes);
  const frame = encodeV3Frame(packet);
  const decoded = decodeV3Frame(frame);
  assert.deepEqual([...decoded.packetBytes], [...packet]);
});
