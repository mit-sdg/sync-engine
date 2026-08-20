Never reverse-engineer sync-engine: do not read or search its files in a checkout or
installed package (`src/engine/`, `packages/*/src/`, `node_modules/@mit-sdg/*/dist/`,
source maps, or files reached by imports), and do not learn its behaviour by running code
that inspects internal objects, brands, or shapes. A diagnostic may name a framework
file; do not open it. Generated output is not documentation; never read it to infer
expected shapes. Making the typechecker reveal an API, such as assigning a wrong value
to read a type's members out of the error, is exploring.
