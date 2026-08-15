# Getting started

This tutorial initializes and runs a concept-free sync-engine application in
an existing Bun package. Add registrations to `src/concepts.ts`, real
composition modules under `src/compositions/`, and runtime options to
`src/assembly.ts`.

For setup behavior in partial or already-authored projects, see the
[command-line reference](../reference/cli.md). For the next step, use the
[application authoring guide](authoring.md).

## Prerequisites

Use a Bun version in the [supported range](../../../SUPPORT.md#runtime-and-toolchain).
These commands pin the tutorial's core release and development dependencies:

```sh
mkdir workshop-app
cd workshop-app
bun init -y
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.9
bun add --dev --exact typescript@6
bun add --dev --exact @types/node@24.0.0
```

## Initialize the application files

```sh
bunx sync-engine setup
```

`setup` writes only missing application files. It does not edit
`package.json` or replace an existing file. It also reports missing dependencies
and scripts as guidance. Apply that guidance before running the checks. For
this tutorial, add these scripts to `package.json`:

```json
{
  "scripts": {
    "generate": "sync-engine artifacts pin",
    "check": "sync-engine check && sync-engine artifacts check && tsc --noEmit",
    "start": "bun src/main.ts"
  }
}
```

The command creates this concept-free structure:

```text
generated.config.ts
tsconfig.json
src/
  assembly.ts
  main.ts
  concepts.ts
```

## Stable extension points

`src/concepts.ts` starts with no registrations:

```ts
import { conceptSet } from "@mit-sdg/sync-engine/assembly";

export const applicationConceptSet = conceptSet({});
export const { concepts } = applicationConceptSet;
```

`applicationConceptSet` is the complete object passed to assembly. `concepts`
is its authoring facet: composition modules import that alias to refer to named
concept declarations after registrations are added. It is empty in this initial
concept-free application.

A concept-free setup does not create placeholder design or composition files.
Its generated config contains `design: { version: 1, documents: [] }`, the
explicit empty application-design contract. Add real composition modules under
`src/compositions/` when the design calls for them. Until then,
`src/assembly.ts` assembles an empty composition:

```ts
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet } from "./concepts.ts";

export function assembleApplication() {
  return assemble({
    conceptSet: applicationConceptSet,
    composition: {},
  });
}
```

## Run and verify the empty application

Run the commands in order:

```sh
bun run generate
bun run check
bun run start
```

`generate` writes the configured read-back and wire contract. `check` defaults
to `generated.config.ts`, checks concept source and the registered application
design, verifies generated files, and runs TypeScript. The concept-free application
has no concepts or endpoints, so `start` prints `[]`.

Rerun `sync-engine setup` to reconcile setup files. It verifies unchanged
files. If an application-owned file changed, setup leaves it untouched and
reports dependent files it cannot verify. It does not migrate those files.

Continue with [Application authoring](authoring.md). [Execution
semantics](../reference/semantics.md) defines runtime ordering, failures, and
settlement.
