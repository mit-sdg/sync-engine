# Getting started

This introductory walkthrough creates and runs the smallest complete
sync-engine application. It assumes TypeScript `>=6 <7` and supports Bun
`>=1.3.14 <1.4`.
The walkthrough does not cover every authoring form; use the [Public
API](../public-surface.md) and [Execution semantics](../semantics.md) as the
authoritative references.

## Create the project

```sh
bunx --package @mit-sdg/sync-engine@1.0.0-beta.0 sync-engine new note-keeper
cd note-keeper
bun install
```

The command writes a project only when none of its template files would be
overwritten. The generated application has one Noting concept, two endpoints,
an assembly, a local-gateway scenario, and generated-artifact configuration.

## Generated files

```text
note-keeper/
├── README.md
├── generated.config.ts
├── package.json
├── text.d.ts
├── tsconfig.json
└── src/
    ├── assembly.ts
    ├── composition.ts
    ├── concept-set.ts
    ├── edge.ts
    ├── scenario.ts
    └── concepts/
        └── noting/
            ├── noting.test.ts
            ├── noting.ts
            ├── registry.ts
            └── spec.md
```

The files form one lifecycle: specify and implement a behavior, register it,
compose it, assemble it, generate its public contract, and invoke it through a
boundary.

## Run the complete lifecycle

```sh
bun run generate
bun run check
bun run principle
bun run start
```

`generate` writes `generated/note-keeper.md` and `generated/wire.ts`. `check`
compares parsed action and query declarations with the class source, verifies
that generated files match the assembly, and typechecks the project. A
successful source check reports one checked concept; artifact and type checks
are silent on success.

`principle` runs the Noting class directly and prints `principle holds`.
`start` calls the application through its gateway and prints JSON containing a
generated note identifier and the text `buy milk`. The identifier changes
between runs.

If the aggregate check fails, isolate its stages with:

```sh
bun run typecheck
bunx sync-engine check
bunx sync-engine artifacts check
```

## Follow one request through the project

`src/concepts/noting/spec.md` is the authored specification. It states the
concept's purpose and principle, declares action signatures and refusal
branches, and declares query cardinality. Its optional State section is
uninterpreted human notation, not a schema or a class/storage conformance
descriptor. [Concept specification format](../concept-specification.md) defines
exactly which parts are parsed and checked.

`src/concepts/noting/noting.ts` implements the contract as an ordinary class.
Public methods are actions. Methods prefixed with `_` are queries. The class has
no engine base class and no peer concept imports.

`src/concepts/noting/noting.test.ts` drives the principle directly against the
class. This test establishes the concept's behavior independently of any
application composition.

`src/concepts/noting/registry.ts` joins the specification and class. It also
maps each declared refusal code to the `Error` class that signals that refusal.

## Name the concept

`src/concept-set.ts` gives the registration its application name and derives
the vocabulary and implementation set:

```ts
export const noteKeeperConcepts = conceptSet({ Noting: noting });
export const { concepts, vocabulary } = noteKeeperConcepts;
```

`concepts` contains typed, inert references used while authoring composition.
`vocabulary` contains the corresponding names and metadata used by assembly and
tooling.

## Declare the application boundary

`src/composition.ts` defines a former and two endpoints:

```ts
const { Noting } = concepts;

export const notePage = former("the note (note)", ({ note }, { text }) =>
  where(Noting._get({ note }).is({ text })).form({ note, text }),
);

export const WriteNote = endpoint("/notes/write", ({ text, note }) =>
  receive({ text }).then(Noting.write({ text }).responds({ note })).then(respond({ note })),
);

export const GetNote = endpoint("/notes/get", ({ note }) =>
  receive({ note }).then(respond({ page: notePage({ note }) })),
);
```

`WriteNote` receives `text`, asks `Noting.write`, waits for its returned
occurrence, and responds with the new identifier. `GetNote` forms a page from
the current query result. These declarations do not execute while the module is
loaded.

## Assemble and invoke

`src/assembly.ts` installs one vocabulary, implementation set, and composition:

```ts
export function assembleNoteKeeper() {
  return assemble({
    vocabulary,
    instances: noteKeeperConcepts.implementations(),
    composition,
  });
}
```

`src/edge.ts` places the standard gateway in front of the assembly.
`src/scenario.ts` creates a local client, calls `/notes/write`, then calls
`/notes/get`. The local client applies the same JSON serialization boundary as
the HTTP client; it does not expose richer in-process values.

## Generated artifacts

`generated/note-keeper.md` is the assembled design read-back.
`generated/wire.ts` maps each endpoint path to its TypeScript input, output, and
error contract. Both files are derived and should remain in source control.
Change the source declaration, run `bun run generate`, and review the resulting
diff; do not edit generated files directly.

Generated TypeScript checks typed callers. Gateway admission only checks the
route, an outer object, and required-key presence. It does not validate
primitive or nested values by default. Public endpoints can attach explicit
runtime input and successful-output validators as shown in [Application
boundary](application-boundary.md#receive-ask-respond).

Continue to [Define one behavior](concepts.md). The remaining guide sequence is
[Connect independent behaviors](reactions.md), [Views and
formers](views-and-formers.md), and [Application
boundary](application-boundary.md).
