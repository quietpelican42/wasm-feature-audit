/**
 * Plain-JS checks against the built package, so they run on every Node version
 * in `engines` — the TypeScript suite needs type stripping and only runs on 24+.
 *
 *   npm run build && node --test test/smoke.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { audit, parseTarget, FEATURES } = await import('../dist/index.js');

test('negative control: MVP module has no features', () => {
  const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const result = audit(bytes);
  assert.deepEqual(result.features, []);
});

test('detects sign-extension in a minimal function', () => {
  // type section: 1 entry, func ()->()
  // function section: 1 entry, type 0
  // code section: 1 body: locals=0, i64.const 0; i64.extend8_s; drop; end
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section
    0x03, 0x02, 0x01, 0x00, // function section
    0x0a, 0x08, 0x01, 0x06, 0x00, 0x42, 0x00, 0xc2, 0x1a, 0x0b, // code section
  ]);
  const result = audit(bytes);
  assert.deepEqual(
    result.features.map((f) => f.feature.id),
    ['sign-extension'],
  );
});

test('parseTarget round-trips a simple spec', () => {
  assert.deepEqual(parseTarget('node20'), { engine: 'Node.js', version: '20' });
});

test('FEATURES catalog is non-empty and self-consistent', () => {
  const ids = Object.keys(FEATURES);
  assert.ok(ids.length > 10);
  for (const id of ids) assert.equal(FEATURES[id].id, id);
});

test('throws a DecodeError on garbage input', async () => {
  const { DecodeError } = await import('../dist/index.js');
  assert.throws(() => audit(new Uint8Array([1, 2, 3])), DecodeError);
});
