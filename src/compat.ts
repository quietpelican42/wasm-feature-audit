import { engineSupportData } from './data/engine-support.ts';
import type { FeatureId } from './features.ts';
import { FEATURES } from './features.ts';

export type EngineName = 'Chrome' | 'Firefox' | 'Safari' | 'Node.js' | 'Wasmtime';

export const ENGINES: EngineName[] = ['Chrome', 'Firefox', 'Safari', 'Node.js', 'Wasmtime'];

/** Normalized support entry for one feature on one engine. */
export interface EngineSupport {
  /** true: supported unconditionally by this version. false: no known support. null: no data. */
  supported: boolean | null;
  /** First version known to support it, when `supported` is true and not flag-gated. */
  since?: string;
  /** True when support requires a non-default CLI/runtime flag. */
  flagged?: boolean;
  note?: string;
}

interface RawFeatureEntry {
  description: string;
  url: string;
  phase: number | string;
  engines: Record<string, string | boolean | null | [string, string]>;
}

const raw = engineSupportData as unknown as { features: Record<string, RawFeatureEntry> };

function normalize(value: string | boolean | null | [string, string] | undefined): EngineSupport {
  if (value === undefined || value === null) return { supported: null };
  if (value === true) return { supported: true };
  if (value === false) return { supported: false };
  if (Array.isArray(value)) {
    const [version, note] = value;
    if (version === 'flag') return { supported: true, flagged: true, note };
    return { supported: true, since: version, note };
  }
  return { supported: true, since: value };
}

/** Support data for `feature` across every vendored engine. Empty when this tool has no data for it. */
export function supportFor(feature: FeatureId): Partial<Record<EngineName, EngineSupport>> {
  const matrixKey = FEATURES[feature].matrixKey;
  if (!matrixKey) return {};
  const entry = raw.features[matrixKey];
  if (!entry) return {};
  const out: Partial<Record<EngineName, EngineSupport>> = {};
  for (const engine of ENGINES) {
    out[engine] = normalize(entry.engines[engine]);
  }
  return out;
}

/** True when `since`/`target` (both in the engine's own version scheme) means the target is new enough. */
function versionAtLeast(target: string, since: string): boolean {
  const t = target.split('.').map((n) => parseInt(n, 10));
  const s = since.split('.').map((n) => parseInt(n, 10));
  const len = Math.max(t.length, s.length);
  for (let i = 0; i < len; i++) {
    const tv = t[i] ?? 0;
    const sv = s[i] ?? 0;
    if (tv !== sv) return tv > sv;
  }
  return true;
}

export interface TargetSpec {
  engine: EngineName;
  version: string;
}

const TARGET_ALIASES: Record<string, EngineName> = {
  node: 'Node.js',
  'node.js': 'Node.js',
  nodejs: 'Node.js',
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
  wasmtime: 'Wasmtime',
};

/** Parses one `--target` entry like `node20` or `safari17.4` into an engine + version. */
export function parseTarget(spec: string): TargetSpec {
  const match = /^([a-zA-Z.]+)(\d[\d.]*)$/.exec(spec.trim());
  if (!match) {
    throw new Error(
      `Cannot parse target "${spec}". Expected <engine><version>, e.g. "node20" or "safari17.4".`,
    );
  }
  const [, rawEngine, version] = match;
  const engine = TARGET_ALIASES[(rawEngine ?? '').toLowerCase()];
  if (!engine) {
    const known = Object.keys(TARGET_ALIASES).join(', ');
    throw new Error(
      `Unknown engine "${rawEngine}" in target "${spec}". Known engines: ${known}. ` +
        `(workerd is not included: this tool has no sourced per-feature version data for it.)`,
    );
  }
  return { engine, version: version! };
}

export interface TargetCheck {
  feature: FeatureId;
  target: TargetSpec;
  /** true: known-supported, false: known-unsupported, null: no data to judge from. */
  ok: boolean | null;
  reason: string;
}

/** Checks whether `target` supports `feature`, using vendored engine-support data. */
export function checkTarget(feature: FeatureId, target: TargetSpec): TargetCheck {
  const support = supportFor(feature)[target.engine];
  if (!support || support.supported === null) {
    return {
      feature,
      target,
      ok: null,
      reason: `no vendored support data for ${target.engine}`,
    };
  }
  if (support.supported === false) {
    return { feature, target, ok: false, reason: `${target.engine} has no known support` };
  }
  if (support.flagged) {
    return {
      feature,
      target,
      ok: false,
      reason: `${target.engine} only supports this behind a non-default flag${support.note ? ` (${support.note})` : ''}`,
    };
  }
  if (support.since && !versionAtLeast(target.version, support.since)) {
    return {
      feature,
      target,
      ok: false,
      reason: `requires ${target.engine} >= ${support.since}, target is ${target.version}`,
    };
  }
  return {
    feature,
    target,
    ok: true,
    reason: support.since ? `supported since ${target.engine} ${support.since}` : `supported`,
  };
}
