import type { Evidence, FeatureId } from './features.ts';
import { DecodeError, Reader } from './reader.ts';

const MAGIC = 0x6d736100; // '\0asm'

export interface CustomSection {
  name: string;
  byteLength: number;
  offset: number;
}

export interface TargetFeatureEntry {
  prefix: '+' | '-' | '=';
  name: string;
}

export interface DecodeResult {
  byteLength: number;
  version: number;
  evidence: Evidence[];
  customSections: CustomSection[];
  /** Parsed contents of a `target_features` custom section (Rust/LLVM convention), if present. */
  targetFeatures?: TargetFeatureEntry[];
  sectionOrder: string[];
}

const SECTION_NAMES = [
  'custom',
  'type',
  'import',
  'function',
  'table',
  'memory',
  'global',
  'export',
  'start',
  'elem',
  'code',
  'data',
  'datacount',
  'tag',
] as const;

/** Abstract heap-type bytes with the feature (if any) their mere presence implies. */
const ABSTRACT_HEAP: Record<number, { name: string; feature?: FeatureId }> = {
  0x75: { name: 'nocont', feature: 'stack-switching' },
  0x74: { name: 'noexn', feature: 'exceptions' },
  0x73: { name: 'nofunc', feature: 'gc' },
  0x72: { name: 'noextern', feature: 'gc' },
  0x71: { name: 'none', feature: 'gc' },
  0x70: { name: 'func' }, // funcref: baseline MVP table element type, not evidence on its own
  0x6f: { name: 'extern', feature: 'reference-types' },
  0x6e: { name: 'any', feature: 'gc' },
  0x6d: { name: 'eq', feature: 'gc' },
  0x6c: { name: 'i31', feature: 'gc' },
  0x6b: { name: 'struct', feature: 'gc' },
  0x6a: { name: 'array', feature: 'gc' },
  0x69: { name: 'exn', feature: 'exceptions' },
  0x68: { name: 'cont', feature: 'stack-switching' },
};

class Decoder {
  r: Reader;
  evidence: Evidence[] = [];
  customSections: CustomSection[] = [];
  targetFeatures?: TargetFeatureEntry[];
  sectionOrder: string[] = [];

  // Module-wide counters used to tell "declared 1" from "declared >1".
  memoryCount = 0;
  tableCount = 0;
  // Mutability of every global, indexed by global index (imports first, then module globals).
  globalMutable: boolean[] = [];
  importedFunctionCount = 0;

  constructor(bytes: Uint8Array) {
    this.r = new Reader(bytes);
  }

  emit(feature: FeatureId, offset: number, detail: string, functionIndex?: number): void {
    this.evidence.push({ feature, offset, detail, ...(functionIndex !== undefined ? { functionIndex } : {}) });
  }

  // ---- top level -------------------------------------------------------

  decode(): DecodeResult {
    const r = this.r;
    if (r.length < 8) throw new DecodeError('input is shorter than a WebAssembly header', 0);
    const magic = r.view.getUint32(0, true);
    if (magic !== MAGIC) throw new DecodeError('missing \\0asm magic bytes: not a WebAssembly binary', 0);
    const version = r.view.getUint32(4, true);
    r.pos = 8;
    if (version !== 1) throw new DecodeError(`unsupported binary version ${version}`, 4);

    while (!r.eof()) {
      const sectionOffset = r.pos;
      const id = r.u8();
      const size = r.u32();
      const end = r.pos + size;
      if (end > r.length) throw new DecodeError(`section ${id} size runs past end of file`, sectionOffset);
      const name = SECTION_NAMES[id];
      if (name === undefined) throw new DecodeError(`unknown section id ${id}`, sectionOffset);
      this.sectionOrder.push(name);
      // Section ordering (ascending id, id 0 excepted) is a validation concern, not something
      // this decoder enforces: the datacount and tag sections in particular are legitimately
      // placed out of numeric order, and a permissive decoder degrades better than a strict one.
      switch (id) {
        case 0:
          this.customSection(end);
          break;
        case 1:
          this.typeSection(end);
          break;
        case 2:
          this.importSection(end);
          break;
        case 3:
          this.functionSection(end);
          break;
        case 4:
          this.tableSection(end);
          break;
        case 5:
          this.memorySection(end);
          break;
        case 6:
          this.globalSection(end);
          break;
        case 7:
          this.exportSection(end);
          break;
        case 8:
          this.startSection();
          break;
        case 9:
          this.elemSection(end);
          break;
        case 10:
          this.codeSection(end);
          break;
        case 11:
          this.dataSection(end);
          break;
        case 12:
          this.datacountSection();
          break;
        case 13:
          this.tagSection(end);
          break;
      }
      if (r.pos !== end) {
        throw new DecodeError(
          `${name} section: expected to end at byte ${end} but parser stopped at ${r.pos}`,
          r.pos,
        );
      }
    }

    return {
      byteLength: r.length,
      version,
      evidence: this.evidence,
      customSections: this.customSections,
      targetFeatures: this.targetFeatures,
      sectionOrder: this.sectionOrder,
    };
  }

  // ---- shared readers ----------------------------------------------------

  readHeapType(): number | undefined {
    const r = this.r;
    const offset = r.pos;
    const b = r.peek();
    if (b === 0x65) {
      r.u8();
      this.emit('shared-everything-threads', offset, 'shared heap type prefix');
      this.readHeapType();
      return undefined;
    }
    const abstract = ABSTRACT_HEAP[b];
    if (abstract) {
      r.u8();
      if (abstract.feature) this.emit(abstract.feature, offset, `heap type '${abstract.name}'`);
      return undefined;
    }
    // Otherwise this is a concrete type index, encoded as a signed LEB128 (s33).
    return r.s33();
  }

  /** Reads a full reference type: either `ref $t` / `ref null $t`, or a short abstract form. */
  readRefType(context: string): void {
    const r = this.r;
    const offset = r.pos;
    const b = r.peek();
    if (b === 0x63 || b === 0x64) {
      r.u8();
      this.emit('function-references', offset, `explicit ${b === 0x63 ? 'ref null' : 'ref'} type in ${context}`);
      this.readHeapType();
      return;
    }
    this.readHeapType();
  }

  /** Reads a value type (numeric, vector, or reference). */
  readValType(context: string): void {
    const r = this.r;
    const offset = r.pos;
    const b = r.peek();
    if (b === 0x7f || b === 0x7e || b === 0x7d || b === 0x7c) {
      r.u8();
      return;
    }
    if (b === 0x7b) {
      r.u8();
      this.emit('simd', offset, `v128 value type in ${context}`);
      return;
    }
    this.readRefType(context);
  }

  /** Reads a storage type: a field type that may additionally be packed i8/i16 (GC struct/array fields). */
  readStorageType(context: string): void {
    const r = this.r;
    const offset = r.pos;
    const b = r.peek();
    if (b === 0x78 || b === 0x77) {
      r.u8();
      this.emit('gc', offset, `packed field type ${b === 0x78 ? 'i8' : 'i16'} in ${context}`);
      return;
    }
    this.readValType(context);
  }

  readLimits(context: string): { flags: number; min: number; max?: number } {
    const r = this.r;
    const offset = r.pos;
    const flags = r.u8();
    const min = r.u32();
    const hasMax = (flags & 0x01) !== 0;
    const shared = (flags & 0x02) !== 0;
    const mem64 = (flags & 0x04) !== 0;
    const max = hasMax ? r.u32() : undefined;
    if (mem64) this.emit('memory64', offset, `${context}: memory64 index-type flag set`);
    if (shared) this.emit('threads', offset, `${context}: shared flag set`);
    return { flags, min, ...(max !== undefined ? { max } : {}) };
  }

  readBlockType(): void {
    const r = this.r;
    const offset = r.pos;
    const b = r.peek();
    if (b === 0x40) {
      r.u8();
      return;
    }
    if (b >= 0x41 && b <= 0x7f) {
      this.readValType('block type');
      return;
    }
    // Anything else is a (possibly multi-byte) non-negative signed LEB128: a type index.
    r.s33();
    this.emit('multi-value', offset, 'block type referencing a function type by index');
  }

  readMemArg(): { align: number; offset: number; memIndex: number } {
    const r = this.r;
    const at = r.pos;
    const rawAlign = r.u32();
    const hasMemIndex = (rawAlign & 0x40) !== 0;
    const align = rawAlign & ~0x40;
    const offset = r.u32();
    const memIndex = hasMemIndex ? r.u32() : 0;
    if (memIndex > 0) this.emit('multi-memory', at, `memory access on memory #${memIndex}`);
    return { align, offset, memIndex };
  }

  /** Reads one const expression (global init, element/data offset) until its terminating `end`. */
  readConstExpr(context: string): void {
    this.walkInstructions(1, undefined, true, context);
  }

  // ---- sections -----------------------------------------------------------

  customSection(end: number): void {
    const r = this.r;
    const offset = r.pos;
    const name = r.name();
    const byteLength = end - r.pos;
    this.customSections.push({ name, byteLength, offset });
    if (name === 'target_features') {
      this.targetFeaturesSection(end);
      return;
    }
    r.pos = end; // custom sections beyond `name` are opaque payload; skip.
  }

  targetFeaturesSection(end: number): void {
    const r = this.r;
    try {
      const count = r.u32();
      const entries: TargetFeatureEntry[] = [];
      for (let i = 0; i < count; i++) {
        const prefixByte = r.u8();
        const prefix = prefixByte === 0x2b ? '+' : prefixByte === 0x2d ? '-' : '=';
        const name = r.name();
        entries.push({ prefix, name });
      }
      this.targetFeatures = entries;
    } catch {
      // Non-standard payload in a section named `target_features`; ignore rather than fail the whole decode.
    }
    r.pos = end;
  }

  typeSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      this.readRecGroup(i);
    }
    void end;
  }

  readRecGroup(groupStartIndex: number): void {
    const r = this.r;
    const offset = r.pos;
    if (r.peek() === 0x4e) {
      r.u8();
      this.emit('gc', offset, `recursive type group starting at type #${groupStartIndex}`);
      const count = r.u32();
      for (let i = 0; i < count; i++) this.readSubType();
      return;
    }
    this.readSubType();
  }

  readSubType(): void {
    const r = this.r;
    const offset = r.pos;
    const b = r.peek();
    if (b === 0x4f || b === 0x50) {
      r.u8();
      this.emit('gc', offset, `explicit ${b === 0x50 ? 'sub' : 'sub final'} type declaration`);
      const superCount = r.u32();
      for (let i = 0; i < superCount; i++) r.u32();
    }
    this.readCompositeType();
  }

  readCompositeType(): void {
    const r = this.r;
    let offset = r.pos;
    let b = r.u8();
    if (b === 0x65) {
      this.emit('shared-everything-threads', offset, 'shared composite type');
      offset = r.pos;
      b = r.u8();
    }
    if (b === 0x4c || b === 0x4d) {
      this.emit('custom-descriptors', offset, b === 0x4c ? 'describes type index' : 'descriptor type index');
      r.u32();
      offset = r.pos;
      b = r.u8();
    }
    switch (b) {
      case 0x60: {
        const paramCount = r.u32();
        for (let i = 0; i < paramCount; i++) this.readValType('function type parameter');
        const resultOffset = r.pos;
        const resultCount = r.u32();
        for (let i = 0; i < resultCount; i++) this.readValType('function type result');
        if (resultCount > 1) this.emit('multi-value', resultOffset, `function type with ${resultCount} results`);
        return;
      }
      case 0x5e:
        this.emit('gc', offset, 'array type definition');
        this.readStorageType('array element');
        r.u8(); // mutability
        return;
      case 0x5f: {
        this.emit('gc', offset, 'struct type definition');
        const fieldCount = r.u32();
        for (let i = 0; i < fieldCount; i++) {
          this.readStorageType('struct field');
          r.u8(); // mutability
        }
        return;
      }
      case 0x5d:
        this.emit('stack-switching', offset, 'continuation type definition');
        this.readValType('continuation function type');
        return;
      default:
        throw new DecodeError(`unrecognized type-section entry opcode 0x${b.toString(16)}`, offset);
    }
  }

  functionSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) r.u32();
    void end;
  }

  importSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      r.name(); // module
      r.name(); // field
      const kind = r.u8();
      switch (kind) {
        case 0x00: // func
          r.u32();
          this.importedFunctionCount++;
          break;
        case 0x01: // table
          this.tableCount++;
          this.readTableType();
          break;
        case 0x02: // memory
          this.memoryCount++;
          this.readLimits('imported memory');
          if (this.memoryCount > 1) this.emit('multi-memory', r.pos, `imported memory #${this.memoryCount - 1}`);
          break;
        case 0x03: {
          // global
          this.readValType('imported global');
          const mutOffset = r.pos;
          const mutable = r.u8() === 1;
          this.globalMutable.push(mutable);
          if (mutable) this.emit('mutable-globals', mutOffset, 'imported mutable global');
          break;
        }
        case 0x04: // tag (exception-handling)
          r.u8(); // attribute, reserved 0
          r.u32(); // type index
          this.emit('exceptions', r.pos, 'imported exception tag');
          break;
        default:
          throw new DecodeError(`unknown import kind ${kind}`, r.pos);
      }
    }
    void end;
  }

  readTableType(): void {
    const r = this.r;
    const offset = r.pos;
    if (r.peek() === 0x40) {
      // Table-with-initializer-expression form (function-references / GC extension).
      r.u8();
      r.u8(); // reserved, must be 0x00
      this.emit('function-references', offset, 'table type with explicit initializer expression');
      this.readRefType('table element type');
      this.readLimits('table');
      this.readConstExpr('table initializer');
      return;
    }
    this.readRefType('table element type');
    this.readLimits('table');
  }

  tableSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      this.tableCount++;
      if (this.tableCount > 1) this.emit('reference-types', r.pos, `table #${this.tableCount - 1} declared`);
      this.readTableType();
    }
    void end;
  }

  memorySection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      this.memoryCount++;
      if (this.memoryCount > 1) this.emit('multi-memory', r.pos, `memory #${this.memoryCount - 1} declared`);
      this.readLimits('memory');
    }
    void end;
  }

  globalSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      this.readValType('global');
      const mutable = r.u8() === 1;
      this.globalMutable.push(mutable);
      this.readConstExpr('global initializer');
    }
    void end;
  }

  exportSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      r.name();
      const kind = r.u8();
      const offset = r.pos;
      const index = r.u32();
      if (kind === 0x03) {
        if (this.globalMutable[index]) this.emit('mutable-globals', offset, `exported mutable global #${index}`);
      } else if (kind === 0x04) {
        this.emit('exceptions', offset, `exported exception tag #${index}`);
      }
    }
    void end;
  }

  startSection(): void {
    this.r.u32();
  }

  elemSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      const offset = r.pos;
      const flags = r.u32();
      switch (flags) {
        case 0:
          this.readConstExpr('element offset');
          this.readVecU32(`elem segment #${i} func indices`);
          break;
        case 1:
          this.emit('bulk-memory', offset, `passive element segment #${i}`);
          r.u8(); // elemkind, must be 0x00
          this.readVecU32(`elem segment #${i} func indices`);
          break;
        case 2: {
          this.emit('bulk-memory', offset, `active element segment #${i} with explicit table index`);
          const tableIdx = r.u32();
          if (tableIdx > 0) this.emit('reference-types', offset, `element segment targeting table #${tableIdx}`);
          this.readConstExpr('element offset');
          r.u8(); // elemkind
          this.readVecU32(`elem segment #${i} func indices`);
          break;
        }
        case 3:
          this.emit('bulk-memory', offset, `declared element segment #${i}`);
          r.u8(); // elemkind
          this.readVecU32(`elem segment #${i} func indices`);
          break;
        case 4:
          this.emit('reference-types', offset, `active element segment #${i} with expression init list`);
          this.readConstExpr('element offset');
          this.readVecExprs(`elem segment #${i} init exprs`);
          break;
        case 5:
          this.emit('bulk-memory', offset, `passive element segment #${i} (expr list)`);
          this.emit('reference-types', offset, `element segment #${i} with reftype + expr init list`);
          this.readRefType('elem segment reftype');
          this.readVecExprs(`elem segment #${i} init exprs`);
          break;
        case 6: {
          this.emit('bulk-memory', offset, `active element segment #${i} with explicit table index (expr list)`);
          this.emit('reference-types', offset, `element segment #${i} with reftype + expr init list`);
          const tableIdx = r.u32();
          if (tableIdx > 0) this.emit('reference-types', offset, `element segment targeting table #${tableIdx}`);
          this.readConstExpr('element offset');
          this.readRefType('elem segment reftype');
          this.readVecExprs(`elem segment #${i} init exprs`);
          break;
        }
        case 7:
          this.emit('bulk-memory', offset, `declared element segment #${i} (expr list)`);
          this.emit('reference-types', offset, `element segment #${i} with reftype + expr init list`);
          this.readRefType('elem segment reftype');
          this.readVecExprs(`elem segment #${i} init exprs`);
          break;
        default:
          throw new DecodeError(`unknown element segment flags ${flags}`, offset);
      }
    }
    void end;
  }

  readVecU32(_context: string): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) r.u32();
  }

  readVecExprs(context: string): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) this.readConstExpr(context);
  }

  codeSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      const bodySize = r.u32();
      const bodyEnd = r.pos + bodySize;
      const functionIndex = this.importedFunctionCount + i;
      const localGroupCount = r.u32();
      for (let g = 0; g < localGroupCount; g++) {
        r.u32(); // repeat count
        this.readValType('local declaration');
      }
      this.walkInstructions(1, functionIndex, false, `function #${functionIndex}`);
      if (r.pos !== bodyEnd) {
        throw new DecodeError(
          `function #${functionIndex}: body parsed to ${r.pos} but declared size ends at ${bodyEnd}`,
          r.pos,
        );
      }
    }
    void end;
  }

  dataSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      const offset = r.pos;
      const flags = r.u32();
      if (flags === 0) {
        this.readConstExpr('data offset');
      } else if (flags === 1) {
        this.emit('bulk-memory', offset, `passive data segment #${i}`);
      } else if (flags === 2) {
        this.emit('bulk-memory', offset, `active data segment #${i} with explicit memory index`);
        const memIdx = r.u32();
        if (memIdx > 0) this.emit('multi-memory', offset, `data segment targeting memory #${memIdx}`);
        this.readConstExpr('data offset');
      } else {
        throw new DecodeError(`unknown data segment flags ${flags}`, offset);
      }
      const byteLen = r.u32();
      r.bytesN(byteLen);
    }
    void end;
  }

  datacountSection(): void {
    const offset = this.r.pos;
    this.r.u32();
    this.emit('bulk-memory', offset, 'datacount section present');
  }

  tagSection(end: number): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      const offset = r.pos;
      r.u8(); // attribute, reserved 0
      r.u32(); // type index
      this.emit('exceptions', offset, `tag #${i} declared`);
    }
    void end;
  }

  // ---- instruction walker ---------------------------------------------

  /**
   * Walks instructions starting at the current position until control-flow depth returns
   * to 0 (an implicit outer block, matching how function bodies and const expressions are
   * both "instr* end"). `inConstExpr` gates evidence that's only meaningful in that context
   * (extended-const arithmetic looks identical to ordinary arithmetic in code).
   */
  walkInstructions(
    startDepth: number,
    functionIndex: number | undefined,
    inConstExpr: boolean,
    context: string,
  ): void {
    const r = this.r;
    let depth = startDepth;
    while (depth > 0) {
      const offset = r.pos;
      const op = r.u8();
      switch (op) {
        case 0x00: // unreachable
        case 0x01: // nop
          break;
        case 0x02: // block
        case 0x03: // loop
        case 0x04: // if
          this.readBlockType();
          depth++;
          break;
        case 0x05: // else
          break;
        case 0x06: // legacy try
          this.emit('exceptions-legacy', offset, 'try (legacy)');
          this.readBlockType();
          depth++;
          break;
        case 0x07: // legacy catch
          this.emit('exceptions-legacy', offset, 'catch (legacy)');
          r.u32();
          break;
        case 0x08: // throw
          this.emit('exceptions', offset, 'throw');
          r.u32();
          break;
        case 0x09: // rethrow
          this.emit('exceptions', offset, 'rethrow');
          r.u32();
          break;
        case 0x0a: // throw_ref
          this.emit('exceptions', offset, 'throw_ref (exnref)');
          break;
        case 0x0b: // end
          depth--;
          break;
        case 0x0c: // br
        case 0x0d: // br_if
          r.u32();
          break;
        case 0x0e: {
          // br_table
          const n = r.u32();
          for (let i = 0; i < n; i++) r.u32();
          r.u32();
          break;
        }
        case 0x0f: // return
          break;
        case 0x10: // call
          r.u32();
          break;
        case 0x11: // call_indirect
          r.u32();
          {
            const tableIdx = r.u32();
            if (tableIdx > 0) this.emit('reference-types', offset, `call_indirect targeting table #${tableIdx}`);
          }
          break;
        case 0x12: // return_call
          this.emit('tail-call', offset, 'return_call');
          r.u32();
          break;
        case 0x13: // return_call_indirect
          this.emit('tail-call', offset, 'return_call_indirect');
          r.u32();
          r.u32();
          break;
        case 0x14: // call_ref
          this.emit('function-references', offset, 'call_ref');
          r.u32();
          break;
        case 0x15: // return_call_ref
          this.emit('tail-call', offset, 'return_call_ref');
          this.emit('function-references', offset, 'return_call_ref (typed reference)');
          r.u32();
          break;
        case 0x18: // legacy delegate
          this.emit('exceptions-legacy', offset, 'delegate (legacy)');
          r.u32();
          depth--; // delegate closes the try block it belongs to
          break;
        case 0x19: // legacy catch_all
          this.emit('exceptions-legacy', offset, 'catch_all (legacy)');
          break;
        case 0x1a: // drop
        case 0x1b: // select
          break;
        case 0x1c: {
          // typed select
          this.emit('reference-types', offset, 'select (typed)');
          const n = r.u32();
          for (let i = 0; i < n; i++) this.readValType('typed select result');
          break;
        }
        case 0x1f: // try_table
          this.emit('exceptions', offset, 'try_table');
          this.readBlockType();
          this.readTryTableCatches();
          depth++;
          break;
        case 0x20: // local.get
        case 0x21: // local.set
        case 0x22: // local.tee
        case 0x23: // global.get
        case 0x24: // global.set
          r.u32();
          break;
        case 0x25: // table.get
          this.emit('reference-types', offset, 'table.get');
          r.u32();
          break;
        case 0x26: // table.set
          this.emit('reference-types', offset, 'table.set');
          r.u32();
          break;
        case 0x28:
        case 0x29:
        case 0x2a:
        case 0x2b:
        case 0x2c:
        case 0x2d:
        case 0x2e:
        case 0x2f:
        case 0x30:
        case 0x31:
        case 0x32:
        case 0x33:
        case 0x34:
        case 0x35:
        case 0x36:
        case 0x37:
        case 0x38:
        case 0x39:
        case 0x3a:
        case 0x3b:
        case 0x3c:
        case 0x3d:
        case 0x3e:
          this.readMemArg();
          break;
        case 0x3f: // memory.size
        case 0x40: {
          // memory.grow
          const memIdx = r.u32();
          if (memIdx > 0) this.emit('multi-memory', offset, `memory.size/grow on memory #${memIdx}`);
          break;
        }
        case 0x41:
          r.s32();
          break;
        case 0x42:
          r.s64();
          break;
        case 0x43:
          r.f32();
          break;
        case 0x44:
          r.f64();
          break;
        case 0x6a: // i32.add
        case 0x6b: // i32.sub
        case 0x6c: // i32.mul
        case 0x7c: // i64.add
        case 0x7d: // i64.sub
        case 0x7e: // i64.mul
          if (inConstExpr) this.emit('extended-const', offset, `arithmetic op in ${context}`);
          break;
        case 0xc0:
        case 0xc1:
        case 0xc2:
        case 0xc3:
        case 0xc4:
          this.emit('sign-extension', offset, 'sign-extension operator');
          break;
        case 0xd0: // ref.null
          this.emit('reference-types', offset, 'ref.null');
          this.readHeapType();
          break;
        case 0xd1: // ref.is_null
          this.emit('reference-types', offset, 'ref.is_null');
          break;
        case 0xd2: // ref.func
          this.emit('reference-types', offset, 'ref.func');
          r.u32();
          break;
        case 0xd3: // ref.eq
          this.emit('gc', offset, 'ref.eq');
          break;
        case 0xd4: // ref.as_non_null
          this.emit('function-references', offset, 'ref.as_non_null');
          break;
        case 0xd5: // br_on_null
          this.emit('function-references', offset, 'br_on_null');
          r.u32();
          break;
        case 0xd6: // br_on_non_null
          this.emit('function-references', offset, 'br_on_non_null');
          r.u32();
          break;
        case 0xe0: // cont.new
          this.emit('stack-switching', offset, 'cont.new');
          r.u32();
          break;
        case 0xe1: // cont.bind
          this.emit('stack-switching', offset, 'cont.bind');
          r.u32();
          r.u32();
          break;
        case 0xe2: // suspend
          this.emit('stack-switching', offset, 'suspend');
          r.u32();
          break;
        case 0xe3: // resume
          this.emit('stack-switching', offset, 'resume');
          r.u32();
          this.readResumeTable();
          break;
        case 0xe4: // resume_throw
          this.emit('stack-switching', offset, 'resume_throw');
          r.u32();
          r.u32();
          this.readResumeTable();
          break;
        case 0xe5: // resume_throw_ref
          this.emit('stack-switching', offset, 'resume_throw_ref');
          r.u32();
          this.readResumeTable();
          break;
        case 0xe6: // switch
          this.emit('stack-switching', offset, 'switch');
          r.u32();
          r.u32();
          break;
        case 0xfb:
          this.gcOperator(offset);
          break;
        case 0xfc:
          this.miscOperator(offset);
          break;
        case 0xfd:
          this.simdOperator(offset);
          break;
        case 0xfe:
          this.threadsOperator(offset);
          break;
        default:
          if (
            (op >= 0x45 && op <= 0x66) || // comparisons
            (op >= 0x67 && op <= 0xa6) || // unary/binary numeric ops
            (op >= 0xa7 && op <= 0xbf) // conversions
          ) {
            // No immediates.
            break;
          }
          throw new DecodeError(`unknown opcode 0x${op.toString(16)}`, offset);
      }
    }
  }

  readResumeTable(): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      const onCatch = r.u8();
      r.u32(); // tag or label index
      if (onCatch === 0x01) r.u32(); // catch_ref carries an extra label
    }
  }

  readTryTableCatches(): void {
    const r = this.r;
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      const kind = r.u8(); // 0 catch, 1 catch_ref, 2 catch_all, 3 catch_all_ref
      if (kind === 0x00 || kind === 0x01) r.u32(); // tag index
      r.u32(); // label
    }
  }

  gcOperator(instrOffset: number): void {
    const r = this.r;
    const code = r.u32();
    this.emit('gc', instrOffset, `gc opcode 0xfb 0x${code.toString(16)}`);
    switch (code) {
      case 0x00:
      case 0x01:
      case 0x06:
      case 0x07:
      case 0x20:
      case 0x21:
        r.u32();
        break;
      case 0x02:
      case 0x03:
      case 0x04:
      case 0x05:
        r.u32();
        r.u32();
        break;
      case 0x08:
        r.u32();
        r.u32();
        break;
      case 0x09:
      case 0x0a:
      case 0x12:
      case 0x13:
        r.u32();
        r.u32();
        break;
      case 0x0b:
      case 0x0c:
      case 0x0d:
      case 0x0e:
      case 0x10:
        r.u32();
        break;
      case 0x0f: // array.len
      case 0x1a: // any.convert_extern
      case 0x1b: // extern.convert_any
      case 0x1c: // ref.i31
      case 0x1d: // i31.get_s
      case 0x1e: // i31.get_u
        break;
      case 0x11:
        r.u32();
        r.u32();
        break;
      case 0x14:
      case 0x15:
      case 0x16:
      case 0x17:
        this.readRefType('ref.test/ref.cast');
        break;
      case 0x18:
      case 0x19:
      case 0x25:
      case 0x26:
        r.u8(); // cast flags
        r.u32(); // relative depth
        this.readHeapType();
        this.readHeapType();
        break;
      case 0x22:
        this.readHeapType();
        break;
      case 0x23:
      case 0x24:
        this.readHeapType();
        break;
      default:
        throw new DecodeError(`unknown gc subopcode 0xfb 0x${code.toString(16)}`, instrOffset);
    }
  }

  miscOperator(instrOffset: number): void {
    const r = this.r;
    const code = r.u32();
    switch (code) {
      case 0x00:
      case 0x01:
      case 0x02:
      case 0x03:
      case 0x04:
      case 0x05:
      case 0x06:
      case 0x07:
        this.emit('saturating-truncation', instrOffset, `saturating truncation 0xfc 0x${code.toString(16)}`);
        break;
      case 0x08:
        this.emit('bulk-memory', instrOffset, 'memory.init');
        r.u32();
        r.u32();
        break;
      case 0x09:
        this.emit('bulk-memory', instrOffset, 'data.drop');
        r.u32();
        break;
      case 0x0a: {
        this.emit('bulk-memory', instrOffset, 'memory.copy');
        const dst = r.u32();
        const src = r.u32();
        if (dst > 0 || src > 0) this.emit('multi-memory', instrOffset, 'memory.copy across non-zero memory index');
        break;
      }
      case 0x0b: {
        this.emit('bulk-memory', instrOffset, 'memory.fill');
        const mem = r.u32();
        if (mem > 0) this.emit('multi-memory', instrOffset, 'memory.fill on non-zero memory index');
        break;
      }
      case 0x0c:
        this.emit('bulk-memory', instrOffset, 'table.init');
        r.u32();
        r.u32();
        break;
      case 0x0d:
        this.emit('bulk-memory', instrOffset, 'elem.drop');
        r.u32();
        break;
      case 0x0e:
        this.emit('bulk-memory', instrOffset, 'table.copy');
        r.u32();
        r.u32();
        break;
      case 0x0f:
        this.emit('reference-types', instrOffset, 'table.grow');
        r.u32();
        break;
      case 0x10:
        this.emit('reference-types', instrOffset, 'table.size');
        r.u32();
        break;
      case 0x11:
        this.emit('reference-types', instrOffset, 'table.fill');
        r.u32();
        break;
      case 0x12:
        this.emit('memory-control', instrOffset, 'memory.discard');
        r.u32();
        break;
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16:
        this.emit('wide-arithmetic', instrOffset, `wide arithmetic 0xfc 0x${code.toString(16)}`);
        break;
      default:
        throw new DecodeError(`unknown misc subopcode 0xfc 0x${code.toString(16)}`, instrOffset);
    }
  }

  simdOperator(instrOffset: number): void {
    const r = this.r;
    const code = r.u32();
    const feature: FeatureId = code >= 0x100 && code <= 0x113 ? 'relaxed-simd' : 'simd';
    this.emit(feature, instrOffset, `simd opcode 0xfd 0x${code.toString(16)}`);
    if (code <= 0x0b) {
      this.readMemArg();
    } else if (code === 0x0c) {
      r.bytesN(16);
    } else if (code === 0x0d) {
      r.bytesN(16);
    } else if (code >= 0x15 && code <= 0x22) {
      r.u8();
    } else if (code >= 0x54 && code <= 0x5b) {
      this.readMemArg();
      r.u8();
    } else if (code === 0x5c || code === 0x5d) {
      this.readMemArg();
    }
    // Everything else (comparisons, arithmetic, splats, relaxed ops) has no immediate.
  }

  threadsOperator(instrOffset: number): void {
    const r = this.r;
    const code = r.u32();
    if (code === 0x03) {
      this.emit('threads', instrOffset, 'atomic.fence');
      r.u8();
      return;
    }
    const feature: FeatureId = code >= 0x4f ? 'shared-everything-threads' : 'threads';
    this.emit(feature, instrOffset, `atomic opcode 0xfe 0x${code.toString(16)}`);
    if (code <= 0x02) {
      this.readMemArg();
    } else if (code >= 0x10 && code <= 0x4e) {
      this.readMemArg();
    } else if (code >= 0x4f && code <= 0x57) {
      r.u8(); // ordering
      r.u32();
    } else if (code >= 0x58 && code <= 0x5b) {
      r.u8();
      r.u32();
    } else if (code >= 0x5c) {
      r.u8();
      r.u32();
      r.u32();
    }
  }
}

export function decode(bytes: Uint8Array): DecodeResult {
  return new Decoder(bytes).decode();
}
