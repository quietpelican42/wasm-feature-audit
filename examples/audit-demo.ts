/**
 * node examples/audit-demo.ts
 *
 * Builds a tiny module that mixes bulk-memory and threads, then audits it.
 */
import { audit } from '../src/index.ts';

// memory section: shared flag+max (flags=3), min=1 max=1
// function: memory.fill(0,0,0)
const bytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type: ()->()
  0x03, 0x02, 0x01, 0x00, // function 0: type 0
  0x05, 0x04, 0x01, 0x03, 0x01, 0x01, // memory: shared, min1 max1
  0x0a, 0x0d, 0x01, 0x0b, 0x00, 0x41, 0x00, 0x41, 0x00, 0x41, 0x00, 0xfc, 0x0b, 0x00, 0x0b,
]);

const result = audit(bytes);
console.log(`module: ${result.byteLength} bytes`);
for (const f of result.features) {
  console.log(`- ${f.feature.name} [${f.feature.id}]: ${f.evidence.length} occurrence(s)`);
  console.log(`  first: byte ${f.firstEvidence.offset} (${f.firstEvidence.detail})`);
}
