/**
 * The WebAssembly proposals this tool recognizes from a module's bytecode.
 *
 * Each id matches the corresponding key in `data/engine-support.json`, which is
 * sourced from https://github.com/WebAssembly/website `features.json` (see that
 * file's header comment for provenance). Features without a `matrixKey` are
 * detected but have no vendored runtime-support data; they are reported as
 * "extras" rather than in the main compatibility matrix.
 */
export type FeatureId =
  | 'sign-extension'
  | 'saturating-truncation'
  | 'bulk-memory'
  | 'reference-types'
  | 'multi-value'
  | 'mutable-globals'
  | 'tail-call'
  | 'multi-memory'
  | 'memory64'
  | 'extended-const'
  | 'threads'
  | 'gc'
  | 'exceptions-legacy'
  | 'exceptions'
  | 'function-references'
  | 'simd'
  | 'relaxed-simd'
  | 'stack-switching'
  | 'custom-descriptors'
  | 'wide-arithmetic'
  | 'memory-control'
  | 'shared-everything-threads';

export interface FeatureMeta {
  id: FeatureId;
  name: string;
  proposalUrl: string;
  /** Key into data/engine-support.json's `features` map, when this tool vendors compat data for it. */
  matrixKey?: string;
  /** Set when the feature is detected but excluded from the primary compatibility matrix. */
  extra?: boolean;
}

export const FEATURES: Record<FeatureId, FeatureMeta> = {
  'sign-extension': {
    id: 'sign-extension',
    name: 'Sign-extension operators',
    proposalUrl: 'https://github.com/WebAssembly/sign-extension-ops',
    matrixKey: 'signExtensions',
  },
  'saturating-truncation': {
    id: 'saturating-truncation',
    name: 'Non-trapping float-to-int conversions',
    proposalUrl: 'https://github.com/WebAssembly/nontrapping-float-to-int-conversions',
    matrixKey: 'saturatedFloatToInt',
  },
  'bulk-memory': {
    id: 'bulk-memory',
    name: 'Bulk memory operations',
    proposalUrl: 'https://github.com/WebAssembly/bulk-memory-operations',
    matrixKey: 'bulkMemory',
  },
  'reference-types': {
    id: 'reference-types',
    name: 'Reference types',
    proposalUrl: 'https://github.com/WebAssembly/reference-types',
    matrixKey: 'referenceTypes',
  },
  'multi-value': {
    id: 'multi-value',
    name: 'Multi-value',
    proposalUrl: 'https://github.com/WebAssembly/multi-value',
    matrixKey: 'multiValue',
  },
  'mutable-globals': {
    id: 'mutable-globals',
    name: 'Import/export of mutable globals',
    proposalUrl: 'https://github.com/WebAssembly/mutable-global',
    matrixKey: 'mutableGlobals',
  },
  'tail-call': {
    id: 'tail-call',
    name: 'Tail call',
    proposalUrl: 'https://github.com/WebAssembly/tail-call',
    matrixKey: 'tailCall',
  },
  'multi-memory': {
    id: 'multi-memory',
    name: 'Multiple memories',
    proposalUrl: 'https://github.com/WebAssembly/multi-memory',
    matrixKey: 'multiMemory',
  },
  memory64: {
    id: 'memory64',
    name: 'Memory64',
    proposalUrl: 'https://github.com/WebAssembly/memory64',
    matrixKey: 'memory64',
  },
  'extended-const': {
    id: 'extended-const',
    name: 'Extended constant expressions',
    proposalUrl: 'https://github.com/WebAssembly/extended-const',
    matrixKey: 'extendedConst',
  },
  threads: {
    id: 'threads',
    name: 'Threads and atomics',
    proposalUrl: 'https://github.com/WebAssembly/threads',
    matrixKey: 'threads',
  },
  gc: {
    id: 'gc',
    name: 'Garbage collection',
    proposalUrl: 'https://github.com/WebAssembly/gc',
    matrixKey: 'gc',
  },
  'exceptions-legacy': {
    id: 'exceptions-legacy',
    name: 'Exception handling (legacy try/catch)',
    proposalUrl:
      'https://github.com/WebAssembly/exception-handling/blob/master/proposals/exception-handling/legacy/Exceptions.md',
    matrixKey: 'exceptions',
  },
  exceptions: {
    id: 'exceptions',
    name: 'Exception handling (try_table / exnref)',
    proposalUrl: 'https://github.com/WebAssembly/exception-handling',
    matrixKey: 'exceptionsFinal',
  },
  'function-references': {
    id: 'function-references',
    name: 'Typed function references',
    proposalUrl: 'https://github.com/WebAssembly/function-references',
    matrixKey: 'typedFunctionReferences',
  },
  simd: {
    id: 'simd',
    name: 'Fixed-width SIMD',
    proposalUrl: 'https://github.com/WebAssembly/simd',
    matrixKey: 'simd',
  },
  'relaxed-simd': {
    id: 'relaxed-simd',
    name: 'Relaxed SIMD',
    proposalUrl: 'https://github.com/WebAssembly/relaxed-simd',
    matrixKey: 'relaxedSimd',
  },
  'stack-switching': {
    id: 'stack-switching',
    name: 'Stack switching',
    proposalUrl: 'https://github.com/WebAssembly/stack-switching',
    extra: true,
  },
  'custom-descriptors': {
    id: 'custom-descriptors',
    name: 'Custom descriptors',
    proposalUrl: 'https://github.com/WebAssembly/custom-descriptors',
    extra: true,
  },
  'wide-arithmetic': {
    id: 'wide-arithmetic',
    name: 'Wide arithmetic',
    proposalUrl: 'https://github.com/WebAssembly/wide-arithmetic',
    extra: true,
  },
  'memory-control': {
    id: 'memory-control',
    name: 'Memory control (memory.discard)',
    proposalUrl: 'https://github.com/WebAssembly/memory-control',
    extra: true,
  },
  'shared-everything-threads': {
    id: 'shared-everything-threads',
    name: 'Shared-everything threads',
    proposalUrl: 'https://github.com/WebAssembly/shared-everything-threads',
    extra: true,
  },
};

/** One concrete sighting of a feature: where it was first seen and what triggered it. */
export interface Evidence {
  feature: FeatureId;
  /** Byte offset into the module of the instruction/field that triggered detection. */
  offset: number;
  /** Human-readable description, e.g. "struct.new (type #3)" or "memory limits: shared flag set". */
  detail: string;
  /** Index of the enclosing function (code-section index, not including imported functions), when applicable. */
  functionIndex?: number;
}
