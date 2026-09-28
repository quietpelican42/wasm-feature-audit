/** A cursor over a WebAssembly binary, with the LEB128 and primitive readers the format needs. */
export class Reader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  pos: number;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get length(): number {
    return this.bytes.length;
  }

  eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  u8(): number {
    if (this.pos >= this.bytes.length) throw new DecodeError('unexpected end of input', this.pos);
    return this.bytes[this.pos++]!;
  }

  peek(): number {
    if (this.pos >= this.bytes.length) throw new DecodeError('unexpected end of input', this.pos);
    return this.bytes[this.pos]!;
  }

  bytesN(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new DecodeError('unexpected end of input', this.pos);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** Unsigned LEB128, up to 32 bits (returned as a plain number). */
  u32(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
    throw new DecodeError('LEB128 u32 too long', this.pos);
  }

  /** Unsigned LEB128 of arbitrary width, returned as a bigint-safe number when possible. */
  u64(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      const byte = this.u8();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new DecodeError('LEB128 u64 too long', this.pos);
  }

  /** Signed LEB128, 32-bit range. */
  s32(): number {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = this.u8();
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);
    if (shift < 32 && (byte & 0x40) !== 0) {
      result |= -1 << shift;
    }
    return result;
  }

  /** Signed LEB128, 33-bit range (used for block types, which double as type-index refs). */
  s33(): number {
    let result = 0n;
    let shift = 0n;
    let byte = 0;
    do {
      byte = this.u8();
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
    } while ((byte & 0x80) !== 0);
    if (shift < 33n && (byte & 0x40) !== 0) {
      result |= -1n << shift;
    }
    return Number(BigInt.asIntN(33, result));
  }

  s64(): bigint {
    let result = 0n;
    let shift = 0n;
    let byte = 0;
    do {
      byte = this.u8();
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
    } while ((byte & 0x80) !== 0);
    if (shift < 64n && (byte & 0x40) !== 0) {
      result |= -1n << shift;
    }
    return BigInt.asIntN(64, result);
  }

  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  name(): string {
    const len = this.u32();
    const bytes = this.bytesN(len);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

/** Thrown when the byte stream does not parse as a well-formed WebAssembly binary. */
export class DecodeError extends Error {
  offset: number;
  constructor(message: string, offset: number) {
    super(`${message} (at byte offset ${offset})`);
    this.name = 'DecodeError';
    this.offset = offset;
  }
}
