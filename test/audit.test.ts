import assert from 'node:assert/strict';
import test from 'node:test';
import { audit } from '../src/index.ts';
import { checkTarget, parseTarget } from '../src/compat.ts';
import { DecodeError } from '../src/reader.ts';
import { END, I32_CONST, Module, name, u32leb, vec } from './wasm-builder.ts';

function ids(result: ReturnType<typeof audit>): string[] {
  return result.features.map((f) => f.feature.id).sort();
}

/** TS's DOM lib types `BufferSource` against a plain `ArrayBuffer`; our fixtures are just `Uint8Array`. */
function isValidModule(bytes: Uint8Array): boolean {
  return WebAssembly.validate(bytes as unknown as ArrayBuffer);
}

test('negative control: a minimal MVP module (no sections) reports no features', () => {
  const bytes = new Module().toBytes();
  assert.equal(isValidModule(bytes), true, 'fixture must itself be a valid module');
  const result = audit(bytes);
  assert.deepEqual(result.features, []);
  assert.deepEqual(result.extras, []);
});

test('negative control: ordinary arithmetic in a function body is not extended-const', () => {
  // type: ()->() ; function using it ; body: i32.const 1, i32.const 2, i32.add, drop, end
  const typeSec = vec([[0x60, ...u32leb(0), ...u32leb(0)]]);
  const funcSec = vec([u32leb(0)]);
  const body = [...I32_CONST(1), ...I32_CONST(2), 0x6a, 0x1a, END];
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const bytes = new Module().section(1, typeSec).section(3, funcSec).section(10, codeSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), []);
});

test('detects sign-extension operators', () => {
  const typeSec = vec([[0x60, 0x00, 0x00]]);
  const funcSec = vec([u32leb(0)]);
  const body = [0x42, 0x00, 0xc2, 0x1a, END]; // i64.const 0; i64.extend8_s; drop; end
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const bytes = new Module().section(1, typeSec).section(3, funcSec).section(10, codeSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['sign-extension']);
  assert.equal(result.features[0]!.evidence.length, 1);
});

test('detects bulk-memory via memory.fill', () => {
  const memSec = vec([[0x00, 0x01]]); // flags=0 (no max), min=1
  const typeSec = vec([[0x60, 0x00, 0x00]]);
  const funcSec = vec([u32leb(0)]);
  const body = [
    ...I32_CONST(0),
    ...I32_CONST(0),
    ...I32_CONST(0),
    0xfc,
    0x0b,
    0x00, // memory.fill, mem 0
    END,
  ];
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const bytes = new Module().section(1, typeSec).section(3, funcSec).section(5, memSec).section(10, codeSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['bulk-memory']);
});

test('detects threads via a shared memory and an atomic op', () => {
  const memSec = vec([[0x03, 0x01, 0x01]]); // flags=3 (hasMax+shared), min=1, max=1
  const typeSec = vec([[0x60, 0x00, 0x00]]);
  const funcSec = vec([u32leb(0)]);
  const body = [
    ...I32_CONST(0),
    0xfe,
    0x10,
    0x02,
    0x00, // i32.atomic.load align=2 offset=0
    0x1a,
    END,
  ];
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const bytes = new Module().section(1, typeSec).section(3, funcSec).section(5, memSec).section(10, codeSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['threads']);
  assert.ok(result.features[0]!.evidence.length >= 2); // shared flag + atomic op
});

test('detects simd via v128.const', () => {
  const typeSec = vec([[0x60, 0x00, 0x00]]);
  const funcSec = vec([u32leb(0)]);
  const body = [0xfd, 0x0c, ...new Array(16).fill(0), 0x1a, END];
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const bytes = new Module().section(1, typeSec).section(3, funcSec).section(10, codeSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['simd']);
});

test('detects reference-types via table.get and an externref global', () => {
  const tableSec = vec([[0x70, 0x00, 0x01]]); // funcref, flags=0, min=1
  const globalSec = vec([[0x6f, 0x00, 0xd0, 0x6f, END]]); // externref, immutable, init = ref.null extern
  const typeSec = vec([[0x60, 0x00, 0x00]]);
  const funcSec = vec([u32leb(0)]);
  const body = [...I32_CONST(0), 0x25, 0x00, 0x1a, END]; // i32.const 0; table.get 0; drop; end
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const bytes = new Module()
    .section(1, typeSec)
    .section(3, funcSec)
    .section(4, tableSec)
    .section(6, globalSec)
    .section(10, codeSec)
    .toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['reference-types']);
});

test('detects garbage collection via a struct type', () => {
  // type: struct { i32 } (mutable)
  const typeSec = vec([[0x5f, ...u32leb(1), 0x7f, 0x01]]);
  const bytes = new Module().section(1, typeSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['gc']);
});

test('detects tail call via return_call', () => {
  const typeSec = vec([[0x60, 0x00, 0x00]]);
  const funcSec = vec([u32leb(0)]);
  const body = [0x12, ...u32leb(0), END]; // return_call $0 (self)
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const bytes = new Module().section(1, typeSec).section(3, funcSec).section(10, codeSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['tail-call']);
});

test('detects multi-value via a function type with two results', () => {
  const typeSec = vec([[0x60, 0x00, ...u32leb(2), 0x7f, 0x7f]]);
  const bytes = new Module().section(1, typeSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['multi-value']);
});

test('detects memory64 via the memory64 limits flag', () => {
  const memSec = vec([[0x04, 0x01]]); // flags=4 (mem64, no max), min=1
  const bytes = new Module().section(5, memSec).toBytes();
  // Node 24 supports memory64 per vendored compat data; validate as a sanity check.
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['memory64']);
});

test('detects multi-memory via a second declared memory', () => {
  const memSec = vec([
    [0x00, 0x01],
    [0x00, 0x01],
  ]);
  const bytes = new Module().section(5, memSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['multi-memory']);
});

test('detects extended-const via arithmetic in a global initializer', () => {
  // global i32 (immutable) = i32.const 1 + i32.const 2
  const globalSec = vec([[0x7f, 0x00, ...I32_CONST(1), ...I32_CONST(2), 0x6a, END]]);
  const bytes = new Module().section(6, globalSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['extended-const']);
});

test('detects mutable-globals via an exported mutable global', () => {
  const globalSec = vec([[0x7f, 0x01, ...I32_CONST(0), END]]); // i32 mutable
  const exportSec = vec([[...name('g'), 0x03, ...u32leb(0)]]);
  const bytes = new Module().section(6, globalSec).section(7, exportSec).toBytes();
  assert.equal(isValidModule(bytes), true);
  const result = audit(bytes);
  assert.deepEqual(ids(result), ['mutable-globals']);
});

test('detects legacy exception handling via try/catch', () => {
  const typeSec = vec([[0x60, 0x00, 0x00]]);
  const funcSec = vec([u32leb(0)]);
  const tagSec = vec([[0x00, ...u32leb(0)]]);
  const body = [0x06, 0x40, 0x07, ...u32leb(0), 0x1a, 0x0b, END]; // try {} catch 0 { drop } end
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const m = new Module().section(1, typeSec).section(3, funcSec).section(13, tagSec).section(10, codeSec);
  const bytes = m.toBytes();
  const result = audit(bytes);
  assert.ok(ids(result).includes('exceptions-legacy'));
});

test('DecodeError on non-wasm input', () => {
  assert.throws(() => audit(new Uint8Array([1, 2, 3, 4])), DecodeError);
});

test('DecodeError on truncated section', () => {
  const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x00]);
  assert.throws(() => audit(bytes), DecodeError);
});

test('compat: parseTarget accepts engine+version, rejects unknown engine', () => {
  assert.deepEqual(parseTarget('node20'), { engine: 'Node.js', version: '20' });
  assert.deepEqual(parseTarget('safari17.4'), { engine: 'Safari', version: '17.4' });
  assert.throws(() => parseTarget('workerd1'), /workerd is not included/);
  assert.throws(() => parseTarget('bogus'), /Cannot parse target/);
});

test('compat: checkTarget flags a version below the sourced minimum', () => {
  const check = checkTarget('gc', { engine: 'Node.js', version: '18' });
  assert.equal(check.ok, false);
});

test('compat: checkTarget accepts a version at/above the sourced minimum', () => {
  const check = checkTarget('gc', { engine: 'Node.js', version: '22.0' });
  assert.equal(check.ok, true);
});

test('CLI --target exits 1 when the module needs a feature the target lacks', async () => {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const typeSec = vec([[0x60, 0x00, 0x00]]);
  const funcSec = vec([u32leb(0)]);
  const body = [0x42, 0x00, 0xc2, 0x1a, END];
  const codeBody = [...u32leb(0), ...body];
  const codeSec = vec([[...u32leb(codeBody.length), ...codeBody]]);
  const bytes = new Module().section(1, typeSec).section(3, funcSec).section(10, codeSec).toBytes();

  const dir = mkdtempSync(path.join(tmpdir(), 'wfa-test-'));
  const file = path.join(dir, 'sign-ext.wasm');
  writeFileSync(file, bytes);

  const cliUrl = new URL('../src/cli.ts', import.meta.url);
  try {
    execFileSync(process.execPath, [cliUrl.pathname, file, '--target', 'node8'], {
      stdio: 'pipe',
    });
    assert.fail('expected non-zero exit');
  } catch (err) {
    const e = err as { status?: number };
    assert.equal(e.status, 1);
  }
});
