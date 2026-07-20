# Generated reading-circle artifacts

[`../generated.config.ts`](../generated.config.ts) names the assembly and both
output files. The example test compares each output byte-for-byte with a fresh
rendering.

- [`reading-circle.md`](reading-circle.md) is the assembled read-back. It
  projects each registered concept's Purpose and Principle and renders the
  reactions, views, formers, and boundary declarations in this assembly. It is
  derived evidence, not the full authored design.
- [`wire.ts`](wire.ts) is the typed frontend contract derived from the boundary.

Change a concept's behavior in the specifications and implementations linked
from the [concept manifest](../../concepts/README.md). Change application
composition in
[`../src/composition/reading-circle.ts`](../src/composition/reading-circle.ts),
and change assembly choices in [`../src/assembly.ts`](../src/assembly.ts). Then
regenerate the evidence here; do not edit either output by hand.

From the project where the package is installed, regenerate both with
`bunx sync-engine artifacts pin --config node_modules/@mit-sdg/sync-engine/examples/reading-circle/generated.config.ts`.
