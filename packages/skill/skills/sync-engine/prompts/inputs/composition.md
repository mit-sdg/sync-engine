# Composition declarations

`@mit-sdg/sync-engine/language` declares reactions, views, formers and computations;
`@mit-sdg/sync-engine/boundary` declares endpoints. Declaration does not execute:
`assemble` from `@mit-sdg/sync-engine/assembly` registers what these produce.

Import an approved specification through the `@design` alias, which the installed
`tsconfig.json` maps to the design root: `import spec from "@design/concepts/Name.md" with
{ type: "text" }`. `generated.config.ts` lists the same documents as URLs, written
`new URL("./design/types.md", import.meta.url)`.

## Reactions

`reaction`, `when`, `where`, `returned`, `refused`, `no`, `whether`, `earlier` and `is`
come from `@mit-sdg/sync-engine/language`.

```ts
reaction((vars) =>
  when(trigger)
    .where(...conditions)
    .then(...consequences),
);
```

- `returned(pattern?, { by?, except?, exceptBy? }?)` and `refused(...)` match an action's
  outcome; `where(...)` takes conditions; `no(readLine)` and `whether(readLine)` test one.
- `earlier(action, input, output?)` refers to a prior occurrence.
- `is.lt`, `is.le`, `is.gt`, `is.ge`, `is.among` compare.
- `.afterFlowSettles()` may follow `when(trigger)` or a completed stage, then `.then(step)`
  or `.where(...).then(step)`. A chained deferred stage accepts condition lines only.

## Views, formers and computations

`view`, `former`, `form`, `each`, `count` and `compute` come from the same subpath.

```ts
view(name, (input, output, free) => where(...).holds());
former(name, (input, free) => form({ ...shape }));
former(name, (input, free) => where(...).form({ ...shape }));
```

- Builders receive binding bags. Reading a property, including by destructuring, declares a
  stable logic variable in that input, output or free partition. Completed views and formers
  take one object-shaped input mapping.
- A view with no output binding is a predicate and ends in `.holds()`. A view that binds
  output rows returns `.many()` by default and may state `.one()` or `.optional()` instead.
  Stacked `where` blocks are alternatives, and local bindings do not escape the view.
- `each(readLine).where(...).arranged(...)` then a consumer:

| Consumer           | Result                                     | Empty selection |
| ------------------ | ------------------------------------------ | --------------- |
| `.form({ ... })`   | one record per row                         | `[]`            |
| `.count()`         | number of rows                             | `0`             |
| `.first(value)`    | value from the first row after arrangement | `null`          |
| `.distinct(value)` | first-seen distinct values                 | `[]`            |

- `form({ ...shape }).splicing(...formerUses)` merges record-rooted fragments into a host
  record. Every variable a fragment input references must already be bound, literals are
  accepted, and fragment keys must not collide with host or earlier-fragment keys. A plain
  optional fragment drops the host row when absent; `whether(...)` keeps it and fills the
  fragment leaves with `null`.
- `count(query, input, outputVariable)` requires one non-union query reference and its
  complete input mapping; undeclared fields are rejected recursively.
- `compute(named, input, output)` runs a pure function `conceptSet` took as its optional
  second argument and exposed as `set.computations`; it never takes a bare function. Write
  `conceptSet({ ... }, { isLive: ({ now, expiresAt }) => now < expiresAt })`, then
  `compute(set.computations.isLive, { now, expiresAt }, live)`, binding one output variable.
  Build that record before the set; references from separate sets do not mix.
- A query's `"one" | "optional" | "many"` promise links to a record return for `"one"` and
  an array of records otherwise, at type level and at runtime.

## Endpoints

`endpoint`, `receive` and `respond` come from `@mit-sdg/sync-engine/boundary`.

```ts
endpoint(path, vars => receive(input)...then(respond(body)), { input?, validators? });
```

- Paths must be canonical portable absolute URL pathnames and survive WHATWG pathname
  handling unchanged. Queries, fragments, scheme-relative paths, dot segments, malformed
  percent escapes, literal spaces and literal Unicode are rejected.
- `receive(...)` cannot author `path` or `requestId`; `respond(...)` cannot author
  `requestId` or `errorKind`.
- A stage may state `.afterFlowSettles()` to form its response at a settlement frontier; add
  conditions identifying the terminal state the endpoint requires.
- Sibling answers are alternatives, not ordered fall-through: an unconditional sibling
  overlaps every conditional one, and an endpoint records at most one answer. Give each
  branch a condition that excludes the others. Branching on whether an optional input was
  supplied needs a declared computation returning that test; if the design declares none,
  block rather than invent one.
- Validators are explicit and schema-library neutral: `input`, `output` and `domainError`,
  each returning `{ ok: true } | { ok: false; detail?: string }` synchronously, each declared
  at most once per path. The domain-error validator receives the authored response's
  top-level `error` value. Generated types carry no runtime schema semantics.
- `InputContractDecl` takes `required` (a missing listed key returns `INVALID_INPUT`) and
  `defaults` (filled only when a key is absent). Without one, assembly derives the required
  keys by intersecting those every exported `receive(...)` for that path mentions. An
  explicit contract replaces that rather than merging, and only one may declare it per path.
