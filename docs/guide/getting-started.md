# Getting started

```sh
sync-engine new operations-room
cd operations-room
bun install
```

That writes a runnable project. It has one concept (Noting), two endpoints,
and everything needed to generate a wire contract and run a scenario. The rest
of this page walks through what was written and how to add a second behavior.

## What sync-engine new wrote

```
operations-room/
├── package.json
├── tsconfig.json
├── text.d.ts
├── README.md
├── generated.config.ts
└── src/
    ├── scenario.ts
    ├── edge.ts
    ├── assembly.ts
    ├── composition.ts
    ├── concept-set.ts
    └── concepts/
        └── noting/
            ├── spec.md
            ├── noting.ts
            ├── registry.ts
            └── noting.test.ts
```

## The concept: spec to class to test

`src/concepts/noting/spec.md` owns the contract. The `## Purpose` says why it
matters; `## Principle` tells a concrete story. The `actions` fence names
every method the concept exposes and every branch it refuses. The `queries`
fence names its read-only questions and the number of rows each promises.

`src/concepts/noting/noting.ts` implements it as a plain TypeScript class.
Public methods are **actions** — the engine records, invokes, and reacts to
them. Methods prefixed with `_` are **queries** — standing reads the engine
answers without recording.

`src/concepts/noting/registry.ts` connects the class to its specification and
names the Error class that signals each refusal code. `registerConcept` reads
the spec and checks it against the class at registration time.

`src/concepts/noting/noting.test.ts` drives the Principle directly against
the class, with no engine or assembly — the concept is independently testable.

Add another concept by writing a `spec.md`, a class, a `registry.ts`, and a
principle test under `src/concepts/<name>/`, then register it in the concept set.

## The concept set

`src/concept-set.ts` lists every concept in the application:

```ts
export const operationsRoomConcepts = conceptSet({ Noting: noting });
export const { concepts, vocabulary } = operationsRoomConcepts;
```

`vocabulary` binds each name to its class — used by assembly and tooling.
`concepts` gives each composition file typed refs for authoring reactions,
views, and formers.

## The composition

`src/composition.ts` holds a former and two endpoints:

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

`notePage` reads the note and forms a `{ note, text }` result. `WriteNote`
receives `text`, asks Noting to write it, and returns the note. `GetNote`
receives a `note` id and returns the formed page.

## The assembly

`src/assembly.ts` joins the concept set and composition into one engine:

```ts
export function assembleOperationsRoom() {
  return assemble({
    vocabulary,
    instances: operationsRoomConcepts.implementations(),
    composition,
  });
}
```

## Generate, typecheck, and run

```sh
bun run generate    # writes generated/operations-room.md and generated/wire.ts
bun run typecheck
bun run principle   # the concept's story, with no application around it
bun run start       # the scenario, through the gateway
```

The generated read-back and wire contract live under `generated/`. Pin them
with `sync-engine artifacts pin`. The wire contract typechecks every caller
against the concept signatures the assembly exposes.

## Add a second concept

The complete slice works with one concept. To grow it:

1. Write `src/concepts/<name>/spec.md` — the contract.
2. Implement the class beside it.
3. Write a `registry.ts` that registers it with `registerConcept`.
4. Add the registration to the list in `src/concept-set.ts`.
5. Connect the new concept to existing ones in `src/composition.ts` with
   reactions, views, and formers.
6. Run `bun run generate` to refresh the wire contract.

Continue to [Concepts](concepts.md) for authoring a full specification and
class, or to [Reactions](reactions.md) to connect independent behaviors.
