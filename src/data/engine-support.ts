/**
 * Vendored subset of WebAssembly/website's features.json (per-engine version support),
 * fetched from https://github.com/WebAssembly/website/blob/main/features.json
 * at commit fce2e16855e52458e859598d17bfad8690db58ae. Licensed Apache-2.0 (see
 * LICENSE-wasm-website); this file is a hand-picked subset re-expressed as TypeScript,
 * not a verbatim copy of the upstream file.
 *
 * `engines` values come straight from that source: a version string, `true`/`false`
 * (unconditional/no support, no version tracked), `null` (no data), or a
 * `[version-or-"flag", note]` pair when support needs a runtime flag.
 */
export const engineSupportData = {
  "features": {
    "bulkMemory": {
      "description": "Bulk Memory Operations",
      "url": "https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "75",
        "Firefox": "79",
        "Safari": "15",
        "Node.js": "12.5",
        "Wasmtime": "0.20"
      }
    },
    "referenceTypes": {
      "description": "Reference Types",
      "url": "https://github.com/WebAssembly/reference-types/blob/master/proposals/reference-types/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "96",
        "Firefox": "79",
        "Safari": "15",
        "Node.js": "17.2",
        "Wasmtime": "0.20"
      }
    },
    "simd": {
      "description": "Fixed-width SIMD",
      "url": "https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md",
      "phase": 5,
      "engines": {
        "Chrome": "91",
        "Firefox": "89",
        "Safari": "16.4",
        "Node.js": "16.4",
        "Wasmtime": "0.33"
      }
    },
    "relaxedSimd": {
      "description": "Relaxed SIMD",
      "url": "https://github.com/WebAssembly/relaxed-simd/tree/main/proposals/relaxed-simd",
      "phase": 5,
      "engines": {
        "Chrome": "114",
        "Firefox": "145",
        "Safari": [
          "flag",
          "Requires JavaScriptCore flag `useWebAssemblyRelaxedSIMD`"
        ],
        "Node.js": "21.0",
        "Wasmtime": "15"
      }
    },
    "threads": {
      "description": "Threads",
      "url": "https://github.com/WebAssembly/threads/blob/main-legacy/proposals/threads/Overview.md",
      "phase": 4,
      "engines": {
        "Chrome": "74",
        "Firefox": "79",
        "Safari": [
          "14.1",
          "Supported in desktop Safari since 14.1 and iOS Safari since 14.5"
        ],
        "Node.js": "16.4",
        "Wasmtime": "15"
      }
    },
    "gc": {
      "description": "Garbage Collection",
      "url": "https://github.com/WebAssembly/gc",
      "phase": 5,
      "engines": {
        "Chrome": "119",
        "Firefox": "120",
        "Safari": "18.2",
        "Node.js": "22.0",
        "Wasmtime": "47"
      }
    },
    "exceptions": {
      "description": "Legacy Exception Handling",
      "url": "https://github.com/WebAssembly/exception-handling/blob/master/proposals/exception-handling/legacy/Exceptions.md",
      "phase": "inactive",
      "engines": {
        "Chrome": "95",
        "Firefox": "100",
        "Safari": "15.2",
        "Node.js": "17.0",
        "Wasmtime": null
      }
    },
    "exceptionsFinal": {
      "description": "Exception Handling with exnref",
      "url": "https://github.com/WebAssembly/exception-handling/blob/master/proposals/exception-handling/Exceptions.md",
      "phase": 5,
      "engines": {
        "Chrome": "137",
        "Firefox": "131",
        "Safari": "18.4",
        "Node.js": "24.15",
        "Wasmtime": "47"
      }
    },
    "tailCall": {
      "description": "Tail Call",
      "url": "https://github.com/WebAssembly/tail-call/blob/master/proposals/tail-call/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "112",
        "Firefox": "121",
        "Safari": "18.2",
        "Node.js": "20.0",
        "Wasmtime": [
          "22",
          "Enabled by default when using the Cranelift backend, the s390x architecture supports it since 24"
        ]
      }
    },
    "multiValue": {
      "description": "Multi-value",
      "url": "https://github.com/WebAssembly/spec/blob/master/proposals/multi-value/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "85",
        "Firefox": "78",
        "Safari": "13.1",
        "Node.js": "15.0",
        "Wasmtime": "0.17"
      }
    },
    "memory64": {
      "description": "Memory64",
      "url": "https://github.com/WebAssembly/memory64/blob/master/proposals/memory64/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "133",
        "Firefox": "134",
        "Safari": [
          "flag",
          "Supported in Safari Technical Preview 251"
        ],
        "Node.js": "24.0",
        "Wasmtime": "30"
      }
    },
    "multiMemory": {
      "description": "Multiple Memories",
      "url": "https://github.com/WebAssembly/multi-memory/blob/master/proposals/multi-memory/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "120",
        "Firefox": "125",
        "Safari": null,
        "Node.js": "22.0",
        "Wasmtime": "15"
      }
    },
    "extendedConst": {
      "description": "Extended Constant Expressions",
      "url": "https://github.com/WebAssembly/extended-const/blob/master/proposals/extended-const/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "114",
        "Firefox": "112",
        "Safari": "17.4",
        "Node.js": "21.0",
        "Wasmtime": "25"
      }
    },
    "signExtensions": {
      "description": "Sign-extension Operators",
      "url": "https://github.com/WebAssembly/spec/blob/master/proposals/sign-extension-ops/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "74",
        "Firefox": "62",
        "Safari": [
          "14.1",
          "Supported in desktop Safari since 14.1 and iOS Safari since 14.5"
        ],
        "Node.js": "12.0",
        "Wasmtime": true
      }
    },
    "mutableGlobals": {
      "description": "Import/Export of Mutable Globals",
      "url": "https://github.com/WebAssembly/mutable-global/blob/master/proposals/mutable-global/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "74",
        "Firefox": "61",
        "Safari": "13.1",
        "Node.js": "12.0",
        "Wasmtime": true
      }
    },
    "typedFunctionReferences": {
      "description": "Typed Function References",
      "url": "https://github.com/WebAssembly/function-references/blob/main/proposals/function-references/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "119",
        "Firefox": "120",
        "Safari": "18",
        "Node.js": "22.0",
        "Wasmtime": "47"
      }
    },
    "saturatedFloatToInt": {
      "description": "Non-trapping float-to-int Conversions",
      "url": "https://github.com/WebAssembly/spec/blob/master/proposals/nontrapping-float-to-int-conversion/Overview.md",
      "phase": 5,
      "engines": {
        "Chrome": "75",
        "Firefox": "64",
        "Safari": "15",
        "Node.js": "12.5",
        "Wasmtime": true
      }
    }
  }
} as const;
