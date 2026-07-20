# Reading circle

Mara opens a reading circle, Lin joins, and the circle chooses _The
Dispossessed_. Choosing the book opens its discussion without Selecting knowing
about Discussing. Lin can respond because membership policy admits her; the
same policy gives Niko a clear refusal.

From a project where `@mit-sdg/sync-engine` is installed:

```sh
bun node_modules/@mit-sdg/sync-engine/examples/reading-circle/src/scenario.ts
```

The command prints the whole circle page, the `ALREADY_JOINED` refusal, and the
`NOT_A_MEMBER` policy answer.

Read the design from its authored sources into its derived evidence:

1. [`../concepts/`](../concepts/) — each shared generic behavior has its own Purpose,
   Principle, State, Actions, errors, implementation, and principle test. The
   [authoring guide](../concepts/README.md) states the discipline.
2. [`src/concept-set.ts`](src/concept-set.ts) — public references and complete
   implementation floors derived from the concepts' own registries.
3. [`src/composition/reading-circle.ts`](src/composition/reading-circle.ts) —
   the application's reaction, policy views, whole-page former, and boundary
   declarations.
4. [`src/assembly.ts`](src/assembly.ts) — the single assembly call and optional
   ready-made concept instances.
5. [`src/edge.ts`](src/edge.ts) — the fixed gateway and Fetch transport.
6. [`src/client.ts`](src/client.ts) — the HTTP client typed by the generated
   contract, with success-or-error handling.
7. [`generated/reading-circle.md`](generated/reading-circle.md) — the assembled
   read-back derived from the registered concepts and composition.
8. [`generated/wire.ts`](generated/wire.ts) — the generated TypeScript contract
   for the application's boundary.

[`src/scenario.ts`](src/scenario.ts) connects the gateway to the generated
contract without a server.

The scenario selects the concept set's complete deterministic floor. The
concept state and both occurrence logs use memory, so all of them disappear
with the process.

The [generated-artifact README](generated/README.md) states the provenance and
regenerate-and-check discipline. What the contract checks, what the gateway
admits at runtime, and why `createGateway` is fixed are the
[application boundary guide](../../docs/guide/application-boundary.md)'s
territory.
