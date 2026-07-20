# Operations room

This executable application accompanies the [Concept Design
guide](../../docs/guide/getting-started.md). Start with the guide to build a
small whole application; use this directory to see the same structure extended
with responders, selectable reaction packs, swappable policy, alerts,
discussion, and a complete dashboard.

```sh
bun node_modules/@mit-sdg/sync-engine/examples/operations-room/src/scenario.ts
```

Read the application from its authored sources into its derived evidence:

1. [`../concepts/`](../concepts/) — the manifest of shared generic behaviors.
   Each directory owns one full specification, implementation, refusal map,
   registry, and principle test; the [concept map](../concepts/README.md) links
   the specifications.
2. [`src/concept-set.ts`](src/concept-set.ts) — the public references and
   complete implementation floors derived from those registries.
3. [`src/composition/`](src/composition/) — the reactions, policy views,
   formers, and application-boundary declarations, split into small modules.
4. [`src/assembly.ts`](src/assembly.ts) — the explicit composition manifest and
   its selectable packs.
5. [`src/edge.ts`](src/edge.ts) — the fixed gateway and Fetch transport.
6. [`src/client.ts`](src/client.ts) — the HTTP client typed by the generated
   contract, with success-or-error handling.
7. [`generated/operations-room.md`](generated/operations-room.md) — the
   assembled read-back derived from the registered concepts and composition.
8. [`generated/wire.ts`](generated/wire.ts) — the generated TypeScript contract
   for the application's boundary.

[`src/scenario.ts`](src/scenario.ts) runs a complete path through the gateway
with deterministic identities. The [generated-artifact
README](generated/README.md) states the provenance and regeneration discipline.

The layout follows the [application file
grammar](../../docs/guide/application-boundary.md#application-files-and-floors).
Its two local depth choices are the shared concept directory and the split
`src/composition/` directory; they do not change the grammar.
