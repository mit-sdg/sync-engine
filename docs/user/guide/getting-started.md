# Getting started

This tutorial initializes and runs a concept-free sync-engine application in
an existing Bun package. The empty application establishes the extension points
used by hand-authored concepts and by the optional source catalog. For setup
behavior in partial projects, see the [command-line reference](../reference/cli.md).

## Prerequisites

Create a Bun package and install the exact core beta selected for the
application:

```sh
mkdir workshop-app
cd workshop-app
bun init -y
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.7
bun add --dev --exact typescript@6
```

## Initialize the application files

```sh
bunx sync-engine setup
```

`setup` writes only missing files. It neither edits `package.json` nor replaces
an existing file. Apply the dependency and script guidance printed by the
command. For this tutorial, add these scripts to `package.json`:

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

## Run the empty application

```sh
bun run generate
bun run check
bun run start
```

Artifact generation writes the configured read-back and wire contract. The
empty application has no routes, so `start` prints `[]`.

A second `sync-engine setup` invocation writes nothing and reports
byte-identical setup files as verified. If an application file has changed,
setup treats it as application-owned and reports any dependent setup it could
not verify.

## Add the optional catalog recipe

The independent catalog package copies curated source into the application. It
does not edit the setup files.

```sh
bun add --dev --exact @mit-sdg/sync-engine-catalog@1.0.0-beta.7
bunx catalog add recipe/workshop-selection --floor memory
```

If package requirements are missing, `catalog add` writes nothing and prints
one `bun add --exact` command. Run that command, then repeat the command after
`Next:`. A successful add copies the concepts, recipe, and tests; writes catalog
wiring under `src/catalog/`; and prints the remaining integration work.

Apply every printed step. For this memory-floor example, import and spread
`catalogRegistrations` in `src/concept-set.ts`, import and spread
`catalogComposition` in `src/composition.ts`, and set the assembly's `instances`
to `applicationConcepts.implementations("memory", {})`.

Then verify the integrated application:

```sh
bun run test
bun run generate
bun run check
bun run start
```

See the [catalog package guide](https://github.com/mit-sdg/sync-engine/blob/main/packages/catalog/README.md)
for floor selection and ownership rules. Continue with [Application
authoring](authoring.md) to design and register application-specific concepts.
[Execution semantics](../reference/semantics.md) remains authoritative for
runtime ordering and failure behavior.
