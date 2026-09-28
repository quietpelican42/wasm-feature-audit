import { checkTarget, parseTarget, supportFor } from './compat.ts';
import type { EngineSupport, TargetCheck, TargetSpec } from './compat.ts';
import { decode } from './decoder.ts';
import type { CustomSection, TargetFeatureEntry } from './decoder.ts';
import { FEATURES } from './features.ts';
import type { Evidence, FeatureId, FeatureMeta } from './features.ts';

export { DecodeError } from './reader.ts';
export type { Evidence, FeatureId, FeatureMeta } from './features.ts';
export { FEATURES } from './features.ts';
export type { CustomSection, TargetFeatureEntry } from './decoder.ts';
export type { EngineSupport, TargetCheck, TargetSpec } from './compat.ts';
export { ENGINES, parseTarget } from './compat.ts';

export interface FeatureReport {
  feature: FeatureMeta;
  /** Every recorded sighting of this feature, in encounter order. */
  evidence: Evidence[];
  /** The first sighting: the offset/detail worth showing as the headline reason. */
  firstEvidence: Evidence;
  support: Partial<Record<string, EngineSupport>>;
}

export interface AuditResult {
  byteLength: number;
  binaryVersion: number;
  /** Required-feature reports, one per feature actually detected in the module. */
  features: FeatureReport[];
  /** Detected proposals this tool has no vendored runtime-support data for. */
  extras: FeatureReport[];
  customSections: CustomSection[];
  targetFeaturesSection?: TargetFeatureEntry[];
  /** Cross-check of the module's `target_features` custom section against what was actually detected. */
  targetFeaturesMismatch: { name: string; declaredRequired: boolean; detected: boolean }[];
}

const RUST_TARGET_FEATURE_NAMES: Partial<Record<FeatureId, string[]>> = {
  'bulk-memory': ['bulk-memory'],
  'sign-extension': ['sign-ext'],
  'reference-types': ['reference-types'],
  simd: ['simd128'],
  threads: ['atomics'],
  'exceptions-legacy': ['exception-handling'],
  exceptions: ['exception-handling'],
  'multi-value': ['multivalue'],
  'tail-call': ['tail-call'],
  'extended-const': ['extended-const'],
  'multi-memory': ['multimemory'],
  'mutable-globals': ['mutable-globals'],
  gc: ['gc'],
  'relaxed-simd': ['relaxed-simd'],
  'function-references': ['function-references'],
};

/** Decodes a WebAssembly binary and reports which proposals it requires. */
export function audit(bytes: Uint8Array): AuditResult {
  const decoded = decode(bytes);

  const byFeature = new Map<FeatureId, Evidence[]>();
  for (const ev of decoded.evidence) {
    const list = byFeature.get(ev.feature);
    if (list) list.push(ev);
    else byFeature.set(ev.feature, [ev]);
  }

  const features: FeatureReport[] = [];
  const extras: FeatureReport[] = [];
  for (const [id, evidence] of byFeature) {
    const meta = FEATURES[id];
    const report: FeatureReport = {
      feature: meta,
      evidence,
      firstEvidence: evidence[0]!,
      support: meta.matrixKey ? supportFor(id) : {},
    };
    if (meta.extra) extras.push(report);
    else features.push(report);
  }
  features.sort((a, b) => a.firstEvidence.offset - b.firstEvidence.offset);
  extras.sort((a, b) => a.firstEvidence.offset - b.firstEvidence.offset);

  const targetFeaturesMismatch: { name: string; declaredRequired: boolean; detected: boolean }[] = [];
  if (decoded.targetFeatures) {
    const detectedSlugs = new Set<string>();
    for (const id of byFeature.keys()) {
      for (const slug of RUST_TARGET_FEATURE_NAMES[id] ?? []) detectedSlugs.add(slug);
    }
    for (const entry of decoded.targetFeatures) {
      targetFeaturesMismatch.push({
        name: entry.name,
        declaredRequired: entry.prefix === '+',
        detected: detectedSlugs.has(entry.name),
      });
    }
  }

  return {
    byteLength: decoded.byteLength,
    binaryVersion: decoded.version,
    features,
    extras,
    customSections: decoded.customSections,
    ...(decoded.targetFeatures ? { targetFeaturesSection: decoded.targetFeatures } : {}),
    targetFeaturesMismatch,
  };
}

/** Checks an audit result against one or more `--target` specs; returns every failing (feature, target) pair. */
export function checkTargets(result: AuditResult, targets: TargetSpec[]): TargetCheck[] {
  const failures: TargetCheck[] = [];
  for (const target of targets) {
    for (const f of result.features) {
      const check = checkTarget(f.feature.id, target);
      if (check.ok === false) failures.push(check);
    }
  }
  return failures;
}
