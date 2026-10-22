import test from 'node:test';
import assert from 'node:assert/strict';
import { endianness } from 'node:os';
import { encodeFrame, FrameDecoder } from '../src/host/framing';
import { MAX_FRAME } from '../src/shared/protocol';
test('UTF-8 native frames survive byte-by-byte fragmentation and multiple frames', () => {
  const values = [{ text: '中文 👋🏽', id: 1 }, { text: '第二段', id: 2 }];
  const bytes = Buffer.concat(values.map(encodeFrame)); const decoder = new FrameDecoder(); const got: unknown[] = [];
  for (const byte of bytes) got.push(...decoder.push(Buffer.from([byte])));
  decoder.end(); assert.deepEqual(got, values);
  assert.deepEqual(new FrameDecoder().push(bytes), values);
});
test('reject oversized, malformed and truncated frames', () => {
  assert.throws(() => encodeFrame({ text: 'x'.repeat(MAX_FRAME) }), /128 KiB/);
  const header = Buffer.alloc(4); if (endianness() === 'LE') header.writeUInt32LE(MAX_FRAME + 1); else header.writeUInt32BE(MAX_FRAME + 1);
  assert.throws(() => new FrameDecoder().push(header));
  const d = new FrameDecoder(); d.push(encodeFrame({ text: 'ok' }).subarray(0, 8)); assert.throws(() => d.end());
  const bad = encodeFrame('x'); bad[4] = 0x7d; assert.throws(() => new FrameDecoder().push(bad));
});
