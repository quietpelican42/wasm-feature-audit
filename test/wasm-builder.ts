/** Minimal byte-level WebAssembly module builder, used only to build test fixtures. */

export function u32leb(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
}

export function s32leb(n: number): number[] {
  const out: number[] = [];
  let v = n | 0;
  let more = true;
  while (more) {
    let b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) {
      more = false;
    } else {
      b |= 0x80;
    }
    out.push(b);
  }
  return out;
}

export function name(s: string): number[] {
  const bytes = [...new TextEncoder().encode(s)];
  return [...u32leb(bytes.length), ...bytes];
}

export function vec(items: number[][]): number[] {
  return [...u32leb(items.length), ...items.flat()];
}

export function section(id: number, body: number[]): number[] {
  return [id, ...u32leb(body.length), ...body];
}

export class Module {
  sections: number[][] = [];

  section(id: number, body: number[]): this {
    this.sections.push(section(id, body));
    return this;
  }

  toBytes(): Uint8Array {
    return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...this.sections.flat()]);
  }
}

// Common opcode shorthands used across fixtures.
export const END = 0x0b;
export const I32_CONST = (n: number) => [0x41, ...s32leb(n)];
export const I64_CONST = (n: bigint) => {
  const out: number[] = [];
  let v = n;
  let more = true;
  while (more) {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if ((v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0)) more = false;
    else b |= 0x80;
    out.push(b);
  }
  return [0x42, ...out];
};
