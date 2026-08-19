# Composition declarations

`@mit-sdg/sync-engine/language` declares reactions, views, formers and computations;
`@mit-sdg/sync-engine/boundary` declares endpoints. Declaration does not execute:
`assemble` from `@mit-sdg/sync-engine/assembly` registers what these produce.

## Reactions

```ts
import {
  reaction,
  when,
  where,
  returned,
  refused,
  no,
  whether,
  earlier,
  is,
} from "@mit-sdg/sync-engine/language";

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
  or `.where(...).then(step)`. An initial deferred stage also accepts one frame function; a
  chained deferred stage accepts condition lines only.

## Views, formers and computations

```ts
import { view, former, form, each, count, compute } from "@mit-sdg/sync-engine/language";

view(name, (input, output, free) => where(...));
former(name, (input, free) => form({ ...shape }));
former(name, (input, free) => where(...).form({ ...shape }));
```

- Builders receive binding bags. Reading a property, including by destructuring, declares a
  stable logic variable in that input, output or free partition. Completed views and formers
  take one object-shaped input mapping.
- `each(readLine).where(...).arranged(...)` then a consumer:

| Consumer           | Result                                     | Empty selection |
| ------------------ | ------------------------------------------ | --------------- |
| `.form({ ... })`   | one record per row                         | `[]`            |
| `.count()`         | number of rows                             | `0`             |
| `.first(value)`    | value from the first row after arrangement | `null`          |
| `.distinct(value)` | first-seen distinct values                 | `[]`            |

- `form({ ...shape }).splicing(...formerUses)` merges record-rooted fragments into a host
  record. Every variable a fragment input references must already be bound; literals are
  accepted; fragment keys must not collide with host or earlier-fragment keys. A plain
  optional fragment drops the host row when absent, `whether(...)` keeps the row and fills
  its leaves with `null`.
- `count(query, input, outputVariable)` requires one non-union query reference and its
  complete input mapping; undeclared fields are rejected recursively.
- `compute(namedComputation, input, output)` names a computation the concept set supplies.
- A query's `"one" | "optional" | "many"` promise links to a record return for `"one"` and
  an array of records otherwise, at type level and at runtime.

## Endpoints

```ts
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";

endpoint(path, vars => receive(input)...then(respond(body)), { input?, validators? });
```

- Paths must be canonical portable absolute URL pathnames. Queries, fragments,
  scheme-relative paths, dot segments, malformed percent escapes, literal spaces and literal
  Unicode are rejected; the declared spelling must survive WHATWG pathname handling
  unchanged.
- `receive(...)` cannot author `path` or `requestId`; `respond(...)` cannot author
  `requestId` or `errorKind`.
- A stage may state `.afterFlowSettles()` to form its response at a settlement frontier; add
  conditions identifying the terminal state the endpoint requires.
- Validators are explicit and schema-library neutral: `input`, `output` and `domainError`,
  each returning `{ ok: true } | { ok: false; detail?: string }` synchronously. The
  domain-error validator receives exactly the authored response's top-level `error` value. A
  path may declare each validator at most once. Generated types and State notation carry no
  runtime schema semantics.
- `InputContractDecl` takes `required` (default `[]`; a missing listed key returns
  `INVALID_INPUT`) and `defaults` (default `{}`; fills listed keys only when absent). Without
  an explicit contract, assembly derives required keys by intersecting the non-reserved keys
  every exported `receive(...)` pattern for that path mentions. An explicit contract replaces
  the derived one rather than merging, and at most one declaration may supply it per path.
