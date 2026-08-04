# {{heading}}

This project contains one complete sync-engine application: the Noting concept,
two endpoints, an assembly, a local-gateway scenario, and generated contracts.
Its runtime and toolchain requirements are declared in `package.json`.

## Install and run

```sh
bun install
bun run generate
bun run check
bun run principle
bun run start
```

`generate` writes `generated/{{slug}}.md` and `generated/wire.ts`. `check`
compares parsed action and query declarations with the class source, checks both
generated files, runs application diagnostics, and typechecks the project.
`principle` tests Noting without an assembly. `start` writes and reads a note,
then observes the explicit `NOTE_NOT_FOUND` result through the standard gateway.

A concept's State section is optional uninterpreted human notation. It has no
schema semantics, comparison with class fields or storage, or role in
generated artifacts or endpoint validators. Establish its properties in
principle, implementation, and backend constraint tests.

Use these commands to isolate a failed check:

```sh
bun run typecheck
bunx sync-engine check --config generated.config.ts
bunx sync-engine artifacts check
```

## Add a behavior

1. Add `src/concepts/<name>/spec.md`, its class, a principle test, and a
   `registry.ts` mapping every declared refusal code to an `Error` class.
2. Add the registration to `src/concept-set.ts`.
3. Connect the concept in `src/composition.ts` with reactions, views, formers,
   or endpoints.
4. Run `bun run generate`, review both generated files, and run
   `bun run check`.

Generated files are derived from `generated.config.ts`; do not edit them by
hand. Documentation matching the installed package is under
`node_modules/@mit-sdg/sync-engine/docs/`. The [online documentation
index](https://github.com/mit-sdg/sync-engine/blob/main/docs/index.md) tracks the
current development branch and may differ from this installed beta release.
