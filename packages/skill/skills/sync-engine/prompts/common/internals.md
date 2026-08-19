Never reverse-engineer sync-engine: do not read or search its files in a checkout or
installed package (`src/engine/`, `packages/*/src/`, `node_modules/@mit-sdg/*/dist/`,
source maps, or files reached by imports), and do not learn its behaviour by running code
that inspects internal objects, brands, or shapes. A diagnostic may name a framework
file; do not open it. Generated output is not documentation; never read it to infer
expected shapes. Use only supplied prompt material and assigned paths; when they are
insufficient—at the latest when a focused check fails the same way twice—return a context
blocker rather than explore.
