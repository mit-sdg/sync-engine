# Contributing to the catalog

This guide applies to changes under `packages/catalog/`. Use the repository-root
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) for checkout, review, and pull-request
workflow.

Package documentation stays with the package:

- `README.md` owns progressive usage;
- `public-surface.md` owns the supported CLI, manifest, lock, generated-file,
  and failure contracts;
- this file owns entry design, authoring, and verification.

Do not add catalog design notes under `docs/`. Complete application wiring,
artifact configuration, gateways, clients, host adapters, and runnable scenarios
belong in self-contained packages under [`examples/`](../../examples/README.md),
not in catalog entries.

## Entry quality bar

Add an entry only when it provides a reusable application capability with a
clear owner and observable contract.

- A **concept** independently owns state, actions, queries, and expected
  refusals.
- A **computation** is a reusable pure vocabulary function.
- A **recipe** expresses reusable composition: a policy, boundary, reaction,
  view, former, or related set of those declarations.

The supported kinds are exactly `concept`, `computation`, and `recipe`. Complete
applications remain examples rather than catalog entry kinds. The current
absence of a computation entry does not justify a filler entry.

Every entry needs executable evidence for the behavior that makes the entry
useful. Evidence must cover contractual refusals, state preservation,
cardinality, and ordering where they apply. One successful construction is not
enough when the contract distinguishes failure or order.

Names, summaries, and examples must not claim authentication, authorization,
audit, durability, external delivery, idempotency, or exactly-once behavior that
the source and evidence do not establish. A profile association is not
authentication. An in-app record is not external delivery. Process-local state
is not durable state.

## Design sequence

Before writing source:

1. State the common application capability, its observable value, and what it
   does not provide.
2. Assign each state transition to one concept owner. Keep cross-concept policy
   in a recipe instead of coupling concept implementations.
3. Specify accepted inputs, state changes, query cardinality, ordering, refusal
   precedence, idempotency, and trust boundaries where relevant.
4. Identify exact catalog dependencies, package requirements, and implementation
   seams. A variant changes implementation, not concept semantics.
5. Define evidence for the principle, normal behavior, state-preserving
   refusals, cardinality, ordering, and failure boundaries.
6. Decide whether a complete application example is needed to demonstrate
   assembly or operational use. If so, add or extend one self-contained example
   separately; the catalog still copies only reusable source.

`concept/profiling` demonstrates an implementation seam. Its `memory` and
`repository` variants share one specification, registration, refusal contract,
and conformance expectation. The repository variant delegates atomic
principal-unique creation to an application repository. It does not alter
Profiling semantics or establish that an arbitrary repository is durable.

Reject proposals that duplicate an existing entry under different application
vocabulary, combine unrelated state owners, or require the installer to infer
semantic equivalence.

## Source layout and IDs

Every entry lives under `entries/<kind>/<name>/` and appears once in
`entries/index.json`. Its ID is the same lowercase kebab-case path:

```text
concept/profiling
computation/normalizing-name
recipe/account-center
```

The computation ID above illustrates the grammar; it is not a shipped entry.
Do not list hypothetical entries in user-facing catalog documentation.

Keep specifications, common concept registration, and shared evidence outside
variant directories. Put implementation-specific source and evidence under the
variant when more than one implementation exists.

## Implementation sequence

1. Write or update the concept specification or recipe contract. Record state
   ownership, actions, queries, refusals, ordering, recovery, and trust
   assumptions in entry-owned source.
2. Implement source under `entries/<kind>/<name>/`. Keep concept implementations
   independent of peer concepts.
3. Add executable evidence beside the copied source. Exercise concepts directly
   and composed policy at the narrowest practical level.
4. Add the exact manifest and register it once in `entries/index.json`.
5. Add registry and installer tests for parsing, dependency resolution,
   rendering, package requirements, ownership, collisions, selected variants,
   lock data, and generated integration.
6. Update `README.md` for ordinary use and `public-surface.md` for every
   observable command, option, format, entry, output, or failure change.
7. Add complete wiring and a scenario under `examples/` only when the reusable
   entry cannot establish the application lifecycle by itself.
8. Verify both the source checkout and the packed tarball in an isolated
   ordinary consumer.

## Manifest contract

Every manifest uses schema 1 and the exact fields accepted by
`src/registry.ts`. Unknown fields are errors. Common fields include `id`,
`kind`, `summary`, optional exact `requires`, optional package `packages`, and
kind-specific copied files and integration metadata.

File targets use only these tokens:

| Token            | Destination                        |
| ---------------- | ---------------------------------- |
| `$concepts/`     | Configured concept source root     |
| `$computations/` | Configured computation source root |
| `$recipes/`      | Configured recipe source root      |

A concept may copy only below `$concepts/`, a computation only below
`$computations/`, and a recipe only below `$recipes/`. There is no project-root
or concept-set target. The configured concept-set path is an application-owned
reference used to render recipe imports; it is not copied from a manifest.

Sources are relative to the entry directory. Source and target paths must stay
inside their owners and remain portable across supported Linux, macOS, and
Windows environments.

### Concept manifests and variants

A concept declares common files, one or more implementation variants, and
`concept` integration metadata. The relevant shape is:

```json
{
  "schema": 1,
  "id": "concept/profiling",
  "kind": "concept",
  "summary": "Associate one display profile with each opaque external principal.",
  "files": [
    { "source": "spec.md", "target": "$concepts/profiling/spec.md" },
    { "source": "registry.ts", "target": "$concepts/profiling/registry.ts" }
  ],
  "variants": {
    "memory": {
      "summary": "Dependency-free in-memory state with injectable identity generation.",
      "files": [
        {
          "source": "variants/memory/profiling.ts",
          "target": "$concepts/profiling/profiling.ts"
        },
        {
          "source": "variants/memory/profiling.test.ts",
          "target": "$concepts/profiling/profiling.test.ts"
        }
      ]
    },
    "repository": {
      "summary": "Application-supplied synchronous repository with atomic profile creation.",
      "files": [
        {
          "source": "variants/repository/profiling.ts",
          "target": "$concepts/profiling/profiling.ts"
        },
        {
          "source": "variants/repository/profiling.test.ts",
          "target": "$concepts/profiling/profiling.test.ts"
        }
      ]
    }
  },
  "concept": {
    "name": "Profiling",
    "registration": "$concepts/profiling/registry.ts",
    "export": "profiling"
  }
}
```

Every variant shares the concept specification, registration, action and query
shapes, refusal contract, and conformance expectation. Use a variant for a real
implementation seam such as storage. Do not use variants to change concept
meaning. The application selects a multi-variant concept explicitly at first
installation; no manifest field selects or constrains a variant on its behalf.

Concept evidence must run the implementation directly. For storage variants,
test the required atomic operation rather than substituting a read followed by a
separate write.

### Computation manifests

A computation manifest declares one copied module and every public vocabulary
function contributed by that module:

```json
{
  "schema": 1,
  "id": "computation/normalizing-name",
  "kind": "computation",
  "summary": "Normalize a display name.",
  "files": [
    {
      "source": "normalizing-name.ts",
      "target": "$computations/normalizing-name.ts"
    }
  ],
  "computation": {
    "module": "$computations/normalizing-name.ts",
    "exports": ["normalizeName"]
  }
}
```

This is a schema example, not a shipped computation. Computations must be pure.
Evidence should call them directly over representative and boundary values.

### Recipe manifests and helpers

A recipe declares exact catalog dependencies, copied source, and only the named
members contributed to assembled composition:

```json
{
  "schema": 1,
  "id": "recipe/browser-session",
  "kind": "recipe",
  "summary": "Compose identifier-secret authentication, profiles, and server-side sessions behind a same-origin browser cookie boundary.",
  "requires": ["concept/authenticating", "concept/sessioning", "concept/profiling"],
  "packages": {
    "@mit-sdg/sync-engine-http": "1.0.0-beta.8"
  },
  "files": [
    { "source": "spec.md", "target": "$recipes/browser-session.spec.md" },
    { "source": "browser-session.ts", "target": "$recipes/browser-session.ts" },
    {
      "source": "browser-session.test.ts",
      "target": "$recipes/browser-session.test.ts"
    }
  ],
  "recipe": {
    "module": "$recipes/browser-session.ts",
    "test": "$recipes/browser-session.test.ts",
    "members": ["Register", "SignIn", "CurrentSession", "RotateSession", "SignOut", "SignOutAll"]
  }
}
```

The installer generates named imports only for `recipe.members`. A recipe may
export application helpers, configuration constructors, and types in addition
to those members. Such exports must be imported directly from the copied module;
they must not be added to `members` unless they are valid assembled composition
members. `browserSessionHttpPolicy` is the current example of a direct helper
export.

Recipe source may use `@catalog/concepts` for the configured concept-set
reference. Paired evidence may use `@catalog/recipe` for the installed recipe
module. The installer replaces those tokens with relative imports. Do not rely
on additional aliases or AST rewriting.

## Evidence requirements

Evidence must be small enough to inspect and complete enough to fail when the
entry's contract changes.

For concepts, test:

- the specification principle;
- normal state transitions and query answers;
- each meaningful refusal and required refusal precedence;
- unchanged state after refusal or host failure;
- cardinality, identity, and ordering guarantees;
- each implementation variant against equivalent expectations.

For recipes, test:

- every declared manifest member loads;
- endpoint paths and required input contracts;
- runtime validators and exact domain-error sets when supplied;
- branch and recovery behavior that the recipe claims;
- helper configuration defaults and allowed customization;
- that helper exports are absent from generated composition when not members.

Tests establish behavior for their stated setup. Do not turn one fixture's
observation into an unconditional contract without implementation support.

## Browser Session security review

Changes to Authenticating, Sessioning, the Browser Session recipe, or its HTTP
helper require explicit review of:

- identifier and secret bounds, refusal precedence, generic credential failure,
  dummy verification, digest storage, and replacement behavior;
- session entropy source, lifetime bounds, expiry cleanup, atomic rotation,
  revocation indexes, and failure before invalidation;
- exact endpoint input and output shapes and rejection of caller identity
  claims;
- cookie input injection, issue-output hiding, every issue and clear route,
  default Origin enforcement, cookie attributes, and public-error mappings;
- interruption between credential, profile, and session owner actions and after
  successful rotation;
- process-local memory, restart, multi-process, rate-limit, recovery,
  verification, and authorization limits.

Do not describe the recipe as complete production authentication. It omits
durable credential and session storage, account recovery, verification,
multi-factor authentication, rate limiting, and resource authorization. A
cookie and valid session do not decide which application resource a principal
may access.

Security-affecting changes need packed evidence using the exact matching core
and HTTP packages. Verify that generated HTTP contracts omit the cookie-bound
input and every consumed issue value and expiry field.

## CLI implementation changes

The CLI implementation is private, but its observable boundaries are supported:

- discovery works without a project or core installation;
- initialization writes one lock and three generated files, not an application
  shell;
- path overrides live only in `catalog.lock.paths`;
- only `init` accepts source-root and integration-path configuration;
- copied source is never overwritten or deleted;
- mutations preflight the complete operation and restore in-process partial
  writes on failure;
- package requirements are reported, not installed;
- the package exports no importable JavaScript API.

Do not add prompts, remote registries, package-manager execution, source merging,
AST editing, or compatibility aliases for unreleased formats.

## Verification

Run focused catalog tests while iterating:

```sh
bun run test packages/catalog/tests
bun run coverage packages/catalog/tests
```

Run repository checks after documentation, source, or manifest changes:

```sh
bun run check
bun run release:check
```

Before review of a catalog release change, verify the packed consumer:

```sh
bun run package:check
bun run release:verify
```

Packed verification must install the produced tarball in an isolated package,
run discovery without the optional core peer, install recipes against exact
companion versions, typecheck copied source, generate and check artifacts, run
copied evidence, and execute a representative scenario. Source-checkout imports
alone do not verify the published package.
