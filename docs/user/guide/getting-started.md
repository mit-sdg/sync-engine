# Getting started

This tutorial initializes and runs a concept-free sync-engine application in
an existing Bun package. It ends with generated artifacts checked, TypeScript
checked, and `src/main.ts` printing the empty route list. The generated files
are extension points: add registrations to `src/concept-set.ts`, composition to
`src/composition.ts`, and runtime options to `src/assembly.ts` as the
application grows.

For setup behavior in partial or already-authored projects, see the
[command-line reference](../reference/cli.md). For the next step, use the
[application authoring guide](authoring.md).

## Prerequisites

Create a Bun package and install the exact core beta selected for the
application. This tutorial uses the repository's current beta and TypeScript
major version:

```sh
mkdir workshop-app
cd workshop-app
bun init -y
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.7
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
    "start": "bun src/main.ts",
    "test": "vp test"
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

The setup files separate declarations from execution. `src/concept-set.ts`
starts with no registrations:

```ts
import { conceptSet } from "@mit-sdg/sync-engine/assembly";

export const applicationConcepts = conceptSet({});
export const { concepts, vocabulary } = applicationConcepts;
```

`src/composition.ts` starts with no composition members:

```ts
export const applicationComposition = {};
```

`src/assembly.ts` assembles those two application-owned extension points:

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

`generate` writes the configured read-back and wire contract. `check` validates
the setup and TypeScript. Because the empty application declares no endpoints,
`start` prints `[]`.

Run `sync-engine setup` again only when you want to reconcile setup files. It
writes nothing for unchanged setup files and reports them as verified. If an
application-owned file has changed, setup leaves it untouched and reports any
dependent file it cannot verify. It is not a migration tool for those files.

Continue with [Application authoring](authoring.md) to design and register
application-specific concepts. [Execution
semantics](../reference/semantics.md) remains authoritative for runtime ordering,
failures, and settlement.
