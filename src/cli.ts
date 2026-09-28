#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { audit, checkTargets, parseTarget } from './index.ts';
import type { AuditResult, TargetSpec } from './index.ts';
import { DecodeError } from './reader.ts';

interface Args {
  file?: string;
  json: boolean;
  targets: string[];
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, targets: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') args.json = true;
    else if (arg === '--target') args.targets.push(...(argv[++i] ?? '').split(',').filter(Boolean));
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (!arg.startsWith('-')) args.file = arg;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return args;
}

const HELP = `wasm-feature-audit <file.wasm> [--target node20,safari17] [--json]

Decodes a WebAssembly binary and reports which proposals (GC, SIMD, threads,
exceptions, tail calls, ...) it requires, with evidence and a runtime support
matrix (Chrome, Firefox, Safari, Node.js, Wasmtime).

  --target <spec,...>  Fail (exit 1) if the module needs a feature any of
                        these targets lacks. Format: <engine><version>, e.g.
                        node20, safari17.4, chrome120, wasmtime26.
  --json                Emit machine-readable JSON instead of text.

Exit codes: 0 clean, 1 findings (module needs a feature a --target lacks),
2 could not analyse (not a valid WebAssembly binary, or no file given).
`;

function formatText(result: AuditResult, file: string): string {
  const lines: string[] = [];
  lines.push(`${file}: ${result.byteLength} bytes, WebAssembly binary version ${result.binaryVersion}`);
  lines.push('');
  if (result.features.length === 0) {
    lines.push('No non-MVP proposals detected.');
  } else {
    lines.push('Required proposals:');
    for (const f of result.features) {
      const ev = f.firstEvidence;
      const where = ev.functionIndex !== undefined ? `function #${ev.functionIndex}, ` : '';
      lines.push(`  ${f.feature.name} [${f.feature.id}]`);
      lines.push(`    first seen: ${where}byte offset ${ev.offset} (${ev.detail})`);
      lines.push(`    ${f.evidence.length} occurrence(s) total`);
      const supportLine = Object.entries(f.support)
        .map(([engine, s]) => {
          if (!s || s.supported === null) return `${engine}: no data`;
          if (s.supported === false) return `${engine}: unsupported`;
          if (s.flagged) return `${engine}: flag-gated${s.since ? ` (${s.since})` : ''}`;
          return `${engine}: >= ${s.since ?? '?'}`;
        })
        .join(', ');
      if (supportLine) lines.push(`    support: ${supportLine}`);
    }
  }
  if (result.extras.length > 0) {
    lines.push('');
    lines.push('Additional proposals detected (no vendored runtime-support data):');
    for (const f of result.extras) {
      lines.push(`  ${f.feature.name} [${f.feature.id}] — first seen at byte offset ${f.firstEvidence.offset}`);
    }
  }
  if (result.targetFeaturesSection) {
    lines.push('');
    lines.push('target_features custom section:');
    for (const entry of result.targetFeaturesSection) {
      lines.push(`  ${entry.prefix}${entry.name}`);
    }
    const mismatches = result.targetFeaturesMismatch.filter((m) => m.declaredRequired !== m.detected);
    if (mismatches.length > 0) {
      lines.push('  mismatches against detected bytecode:');
      for (const m of mismatches) {
        lines.push(`    ${m.name}: declared required=${m.declaredRequired}, detected in bytecode=${m.detected}`);
      }
    }
  }
  return lines.join('\n');
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (args.help || !args.file) {
    process.stdout.write(HELP);
    return args.help ? 0 : 2;
  }

  let targets: TargetSpec[];
  try {
    targets = args.targets.map(parseTarget);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  let bytes: Uint8Array;
  try {
    bytes = readFileSync(args.file);
  } catch (err) {
    process.stderr.write(`Cannot read ${args.file}: ${(err as Error).message}\n`);
    return 2;
  }

  let result: AuditResult;
  try {
    result = audit(bytes);
  } catch (err) {
    if (err instanceof DecodeError) {
      process.stderr.write(`Could not analyse ${args.file}: ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const failures = targets.length > 0 ? checkTargets(result, targets) : [];

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          file: args.file,
          byteLength: result.byteLength,
          binaryVersion: result.binaryVersion,
          features: result.features.map((f) => ({
            id: f.feature.id,
            name: f.feature.name,
            proposalUrl: f.feature.proposalUrl,
            occurrences: f.evidence.length,
            firstEvidence: f.firstEvidence,
            support: f.support,
          })),
          extras: result.extras.map((f) => ({
            id: f.feature.id,
            name: f.feature.name,
            occurrences: f.evidence.length,
            firstEvidence: f.firstEvidence,
          })),
          customSections: result.customSections.map((c) => ({ name: c.name, byteLength: c.byteLength })),
          targetFeaturesSection: result.targetFeaturesSection,
          targetFeaturesMismatch: result.targetFeaturesMismatch,
          targetFailures: failures,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(formatText(result, args.file) + '\n');
    if (failures.length > 0) {
      process.stdout.write('\nTarget check failures:\n');
      for (const f of failures) {
        process.stdout.write(`  ${f.feature} vs ${f.target.engine}${f.target.version}: ${f.reason}\n`);
      }
    }
  }

  return failures.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Internal error: ${(err as Error).stack ?? err}\n`);
    process.exit(2);
  },
);
