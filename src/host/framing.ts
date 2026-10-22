import { endianness } from 'node:os';
import { AppError, MAX_FRAME } from '../shared/protocol';
const little = endianness() === 'LE';
export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (!body.length || body.length > MAX_FRAME) throw new AppError('message_too_large', '消息超出 128 KiB 限制。');
  const header = Buffer.alloc(4);
  if (little) header.writeUInt32LE(body.length); else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const n = little ? this.buffer.readUInt32LE(0) : this.buffer.readUInt32BE(0);
      if (!n || n > MAX_FRAME) throw new AppError('message_too_large', 'Native Messaging 消息大小无效。');
      if (this.buffer.length < n + 4) break;
      try { messages.push(JSON.parse(this.buffer.subarray(4, n + 4).toString('utf8'))); }
      catch { throw new AppError('invalid_json', 'Native Messaging JSON 无效。'); }
      this.buffer = this.buffer.subarray(n + 4);
    }
    return messages;
  }
  end(): void { if (this.buffer.length) throw new AppError('truncated_frame', 'Native Messaging 帧不完整。'); }
}
