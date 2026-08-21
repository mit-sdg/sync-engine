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
  behavior; this specifically forbids `Function.prototype.toString`, `Object.keys`, export
  enumeration, symbol inspection, and logging framework values for discovery;
- do not run exploratory scripts or manufacture invalid calls, option names, assignments,
  or composition shapes merely to make runtime errors or the typechecker enumerate an
  API; and
- do not browse generated output as documentation or use implementation artifacts to
  infer an undocumented input shape; consuming an explicitly supplied public contract is
  allowed.

A diagnostic may name a framework-internal file; use the diagnostic itself and do not
open that file. Ordinary compile-and-fix work against a documented call is allowed. If a
normal documented call fails and the supplied references do not determine the repair,
stop with a context or design blocker before trying alternate API shapes. Insufficient
public context is not permission to probe for the missing API; repeated exploratory
compile or runtime trials are a boundary violation, not progress.
