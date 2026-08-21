# Framework safety

Use supplied public references, examples, explicitly supplied generated public
contracts, and ordinary project diagnostics to implement the assigned work. Run relevant
typechecks and tests, read their complete diagnostics, and repair code in scope. A
naturally occurring error that includes framework types is normal repair evidence.

Do not deliberately probe or reverse-engineer sync-engine. In particular:

- do not read or search framework source, built package internals, source maps, or files
  reached through framework imports;
- do not use broad `node_modules` discovery to reconstruct undocumented APIs;
- do not inspect runtime objects, brands, symbols, or shapes to discover internal
  behavior;
- do not manufacture invalid calls or assignments merely to make the typechecker
  enumerate an API; and
- do not browse generated output as documentation or use implementation artifacts to
  infer an undocumented input shape; consuming an explicitly supplied public contract is
  allowed.

A diagnostic may name a framework-internal file; use the diagnostic itself and do not
open that file. Ordinary compile-and-fix work against documented public APIs is allowed.
Insufficient public context is not permission to probe for the missing API.
