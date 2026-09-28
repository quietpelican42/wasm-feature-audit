# wasm-feature-audit

Decodes a compiled WebAssembly binary and reports exactly which proposals (GC, SIMD, threads, exceptions, tail calls, and a dozen others) it requires, with the byte offset that proves it and a runtime support matrix.

```ts
import { audit } from 'wasm-feature-audit';
import { readFileSync } from 'node:fs';

const result = audit(readFileSync('module.wasm'));
for (const f of result.features) {
  console.log(f.feature.name, f.evidence.length, f.firstEvidence.detail);
}
```

## Why

Nothing available today tells you which WebAssembly proposals a *compiled module* actually requires, as opposed to which proposals a *runtime* supports (that direction is well covered, by `wasm-feature-detect` among others). Checked before writing this:

- `@webassemblyjs/wasm-parser` (last published 2024-11) throws `Unsupported type: 0x5f` on a module that uses the GC proposal, instead of naming the proposal.
- `wasm-tools validate` needs you to already guess which `--features` flags to try; it never reports what a module actually uses, and its default feature set silently accepts most current proposals.
- `wasm-opt` (binaryen) names the missing feature for some proposals (`struct.new requires gc [--enable-gc]`) but for others just says `all used features should be allowed`, with no feature named. `--detect-features` is a deprecated no-op.

Measured: `wasm-feature-audit gc_exn.wasm` against a module built with binaryen that mixes a GC struct type, a typed function reference, and both the legacy and current exception-handling encodings:

```
gc_exn.wasm: 128 bytes, WebAssembly binary version 1

Required proposals:
  Garbage collection [gc]
    first seen: byte offset 11 (struct type definition)
    3 occurrence(s) total
    support: Chrome: >= 119, Firefox: >= 120, Safari: >= 18.2, Node.js: >= 22.0, Wasmtime: >= 47
  Typed function references [function-references]
    first seen: byte offset 26 (explicit ref type in function type result)
    2 occurrence(s) total
    support: Chrome: >= 119, Firefox: >= 120, Safari: >= 18, Node.js: >= 22.0, Wasmtime: >= 47
  Exception handling (try_table / exnref) [exceptions]
    first seen: byte offset 48 (tag #0 declared)
    2 occurrence(s) total
    support: Chrome: >= 137, Firefox: >= 131, Safari: >= 18.4, Node.js: >= 24.15, Wasmtime: >= 47
  Exception handling (legacy try/catch) [exceptions-legacy]
    first seen: byte offset 107 (try (legacy))
    2 occurrence(s) total
    support: Chrome: >= 95, Firefox: >= 100, Safari: >= 15.2, Node.js: >= 17.0, Wasmtime: no data
```

## Installation

```sh
npm install wasm-feature-audit
```

Node >= 20.6. No runtime dependencies: the binary decoder is original code, not a wrapper over `wasm-tools` or `binaryen`.

## Usage

### From the CLI

```sh
wasm-feature-audit module.wasm
wasm-feature-audit module.wasm --json
wasm-feature-audit module.wasm --target node20,safari17
```

`--target` fails the run (exit 1) if the module needs a feature any listed target lacks:

```
$ wasm-feature-audit gc_exn.wasm --target node20,safari17
...
Target check failures:
  gc vs Node.js20: requires Node.js >= 22.0, target is 20
  function-references vs Node.js20: requires Node.js >= 22.0, target is 20
  exceptions vs Node.js20: requires Node.js >= 24.15, target is 20
  gc vs Safari17: requires Safari >= 18.2, target is 17
  function-references vs Safari17: requires Safari >= 18, target is 17
  exceptions vs Safari17: requires Safari >= 18.4, target is 17
```

### From code

`audit(bytes)` returns every required feature with its evidence trail and vendored support data; `checkTargets(result, targets)` reduces that to pass/fail against a target list. See [Reference](#reference) for the full shape.

### Scanning real packages

Run against 13 real `.wasm` files pulled from npm (esbuild-wasm, `@swc/wasm-web`, vscode-oniguruma, harfbuzzjs x2, sql.js x4, yoga-wasm-web, `@jsquash/resize` x3): all 13 decoded without error. Findings: bulk-memory and sign-extension are near-universal in Emscripten/Rust output; two files needed nothing beyond MVP; one (`@jsquash/resize`'s magic-kernel build) also used reference-types. No file used GC, threads, tail calls, or SIMD.

## Reference

### Library

| Export | Signature | What it does |
| --- | --- | --- |
| `audit` | `(bytes: Uint8Array) => AuditResult` | Decodes a module; throws `DecodeError` if it isn't well-formed. |
| `checkTargets` | `(result: AuditResult, targets: TargetSpec[]) => TargetCheck[]` | Every `(feature, target)` pair the module fails. |
| `parseTarget` | `(spec: string) => TargetSpec` | Parses `"node20"` / `"safari17.4"` into `{ engine, version }`. |
| `FEATURES` | `Record<FeatureId, FeatureMeta>` | The full feature catalog (name, proposal URL, matrix key). |
| `DecodeError` | class | Thrown on malformed input; carries a byte `offset`. |

`AuditResult`: `{ byteLength, binaryVersion, features, extras, customSections, targetFeaturesSection?, targetFeaturesMismatch }`. `features` and `extras` are arrays of `{ feature, evidence, firstEvidence, support }`, sorted by first byte offset. `extras` holds proposals this tool recognizes but has no vendored runtime-support data for (stack-switching, custom-descriptors, wide-arithmetic, memory-control, shared-everything-threads).

### CLI flags

| Flag | Description |
| --- | --- |
| `--target <spec,...>` | Comma-separated `<engine><version>` targets, e.g. `node20,chrome120,wasmtime26`. Known engines: `node`, `chrome`, `firefox`, `safari`, `wasmtime`. |
| `--json` | Emit JSON instead of text. |
| `-h`, `--help` | Print usage. |

Exit codes: `0` clean (or findings with no `--target` given), `1` the module needs a feature a `--target` lacks, `2` could not analyse (bad path, or not a valid WebAssembly binary).

### Detected proposals

Bulk memory, reference types, multi-value, mutable-globals, tail call, multiple memories, memory64, extended-const, threads/atomics (incl. shared memory), garbage collection, exception handling (both the legacy `try`/`catch` encoding and the current `try_table`/`exnref` one, reported separately), typed function references, fixed-width SIMD, relaxed SIMD, sign-extension operators, non-trapping float-to-int conversions, plus (as extras) stack switching, custom descriptors, wide arithmetic, `memory.discard`, and shared-everything threads. Custom sections are listed by name and size; a `target_features` section (the Rust/LLVM convention) is parsed and cross-checked against what the bytecode actually uses.

## How it works

A hand-written streaming reader walks every section of the binary format: types (including GC recursive groups and subtyping), imports/exports, tables, memories, globals, elements, data, and every function body's instruction stream, byte by byte. Feature attribution comes from the module's own encoding, cross-referenced against `bytecodealliance/wasm-tools`' opcode tables (the reference implementation nearly every other tool in this space is built on) so each byte value's proposal ownership is verifiable rather than guessed:

- The `0xFC`, `0xFD`, `0xFE`, and `0xFB` prefix bytes each open a different proposal's sub-opcode space (misc/bulk-memory, SIMD, threads/atomics, GC).
- A block type encoded as a signed LEB128 referencing a function type (rather than `0x40` or a single value type) is multi-value even when that function type has zero or one results, because MVP block types could never reference a type index at all.
- Arithmetic opcodes (`i32.add` and friends) are ordinary and unremarkable in a function body; the identical bytes inside a constant expression (a global initializer, or an element/data offset) are extended-const. The decoder tracks this via context, not opcode alone.
- A memory's `shared` limits flag is threads evidence on its own, independent of whether any atomic instruction is present.
- `funcref` alone (a table's default element type) is not flagged as reference-types, since that's legal in the original MVP; `externref`, `table.get`/`table.set`/`table.grow`/`table.size`/`table.fill`, `ref.null`/`ref.is_null`/`ref.func`, typed `select`, and a second table all are.

## Limitations

- Detects requirements, not correctness: this is not a validator. A structurally well-formed but semantically invalid module (bad types, out-of-range indices) will still be decoded and reported on.
- The support matrix covers Chrome, Firefox, Safari, Node.js, and Wasmtime. `workerd` is not included: it embeds a V8 version but this tool has no sourced per-feature mapping from workerd release to V8 version, and inventing one would violate the project's honesty bar.
- Version comparisons are numeric-component comparisons (`20.6` >= `20.6`), not full semver; pre-release/build metadata isn't handled.
- The `target_features` cross-check only recognizes the subset of Rust/LLVM feature names that map onto detected proposals; an unrecognized name is reported but never flagged as a mismatch.
- `--target` only judges the primary feature list, not the `extras` (stack-switching etc.), since there's no vendored version data to judge them against.

## Compatibility

Engine version data (`src/data/engine-support.ts`) is vendored from [`WebAssembly/website`](https://github.com/WebAssembly/website)'s `features.json` at commit `fce2e16855e52458e859598d17bfad8690db58ae`, licensed Apache-2.0 (see `LICENSE-wasm-website`). That file is itself maintained by contributors across the engines it tracks; this project re-expresses a subset of it as TypeScript and does not re-verify each version number independently.

Decoder correctness was checked three ways:

1. A 21-case differential test suite: one hand-built minimal module per proposal (asserting no false positives on a plain MVP module, and exactly one feature detected per fixture), each cross-checked with `WebAssembly.validate()` on the Node version actually running this suite (**v24.20.0**). Every fixture validated as a real module before its detection was asserted.
2. 13 real-world `.wasm` files pulled from published npm packages (see "Scanning real packages" above): all decoded without error, which a decoder this permissive-by-design (it walks bytes it doesn't attribute a feature to, rather than rejecting them) should manage, but a first version of it did not (it lacked `unreachable`/`nop` opcodes and threw on every real file until fixed).
3. `--experimental-wasm-*` flag testing across multiple Node versions and a broader real-world corpus (esbuild-wasm, `@swc/wasm`, ffmpeg.wasm, pyodide) were both in scope but out of time budget for this session; only the current runtime's `WebAssembly.validate()` was exercised, not other Node major versions.

## Development

```sh
npm install
npx tsc --noEmit
node --test "test/*.test.ts"    # full suite, needs node 24+ for type stripping
node examples/audit-demo.ts

npm run build && npm run test:dist   # what CI runs against node 20 and 22
```

## License

MIT
