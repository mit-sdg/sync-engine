# Getting started

This tutorial initializes and runs a concept-free sync-engine application in
an existing Bun package. Add registrations to `src/concept-set.ts`, composition
to `src/composition.ts`, and runtime options to `src/assembly.ts`.

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
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.8
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
    "check": "sync-engine check --config generated.config.ts && sync-engine artifacts check && tsc --noEmit",
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
  composition.ts
  concept-set.ts
  main.ts
```

## Stable extension points

`src/concept-set.ts` starts with no registrations:

```ts
import { conceptSet } from "@mit-sdg/sync-engine/assembly";

export const applicationConcepts = conceptSet({});
export const { concepts, vocabulary } = applicationConcepts;
```

`src/composition.ts` starts with no composition members:

```ts
export const applicationComposition = {};
```

`src/assembly.ts` assembles the concept set and composition:

```ts
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationComposition } from "./composition.ts";
import { applicationConcepts, vocabulary } from "./concept-set.ts";

export function assembleApplication() {
  return assemble({
    vocabulary,
    instances: applicationConcepts.implementations(),
    composition: applicationComposition,
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

`generate` writes the configured read-back and wire contract. `check` compares
concept specifications with their classes, inspects application diagnostics,
verifies the generated files, and runs TypeScript. The concept-free application
has no concepts or endpoints, so `start` prints `[]`.

Rerun `sync-engine setup` to reconcile setup files. It verifies unchanged
files. If an application-owned file changed, setup leaves it untouched and
reports dependent files it cannot verify. It does not migrate those files.

Continue with [Application authoring](authoring.md). [Execution
semantics](../reference/semantics.md) defines runtime ordering, failures, and
settlement.
