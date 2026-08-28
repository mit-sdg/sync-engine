# How sync-engine applications fit together

sync-engine separates reusable concept contracts from the application decisions
that connect them. This page explains those authored contracts, their executable
counterparts, and why design checking occurs in tooling rather than at runtime.
Use [Designing with concepts](design.md) to choose boundaries and [Application
authoring](guide/authoring.md) to create the files.

## Three authored contracts

An application design has three distinct parts:

1. A **concept specification** defines reusable concept-local behavior through
   Purpose, Principle, external Types, structural State, Actions, and Queries.
2. **Application design prose** explains application behavior and links each
   selected reaction, view, and former to the decision it realizes.
3. **Application instance and type declarations** inventory every selected
   concept instance and resolve every concept-external type to a concrete
   application type or a type owned by another selected instance.

These parts answer different questions. A concept specification explains a
mechanism without naming an application. Application prose explains why
selected declarations are present. Instance declarations record which reusable
definitions this exact application variant selects, while external bindings
record how otherwise-independent concept parameters meet in that variant.

New applications should use `design/concepts/*.md`,
`design/compositions/*.md`, and `design/types.md`, conventionally pairing each
composition document with one `src/compositions/*.ts` module. This is an authoring
rule rather than a checker restriction: there is no required `application.md`, and
only explicitly configured local design files participate in checking. Introductions,
history, and unresolved notes may remain ordinary unregistered Markdown.

## From authored design to runtime

```text
concept specifications + registered application documents
                              |
                              v
classes + registrations + reactions + views + formers + endpoints
                              |
                              v
                        selected assembly
                         /           \
                        v             v
                design tooling    runtime invoker
                        |             ^
                        v             |
              manifest/read-back   gateway/client
```

`registerConcept` connects a concept class to imported specification text.
`conceptSet` maps each selected application instance name to the registered
concept definition it realizes and returns one registered concept-set object.
Pass that whole object to `assemble` as `conceptSet`. Its `.concepts` property contains typed declaration references for
writing composition; it is not another concept set and is not the value passed
to `assemble`. Its `.implementations(...)` method constructs implementation
maps when an application selects a default or named floor. Composition builds
reaction, endpoint, view, and former declarations. `assemble` installs the
selected declarations and implementations.

Runtime assembly does not load application design Markdown. Consequently a
production process does not fail merely because authored documentation is not
deployed. The complete design contract is instead mandatory for config-based
tooling: `sync-engine check`, artifact generation, and artifact checking.

## Concept definitions and application instances

A concept owns behavior and state. Its class does not import peer concepts or
application composition. The specification's H1 names the reusable definition,
while the key assigned by `conceptSet` names one application instance. The same
definition may be instantiated several times.

A strict specification has ordered Purpose, Principle, Types, State, Actions,
and Queries sections. Types declares only opaque external parameters. State uses
SSF. A bounded structural parser inventories the declarations, subsets, aliases, and
field-level uniqueness constraints a concept owns, and checks its subset graph and name
uniqueness. Invariants SSF cannot express live on `Rule:` lines and stay opaque; every
other line has to parse.
Actions use explicit `where`/`then` branches and terminal returns or refusals;
queries select `one`, `optional`, or `many`, return named rows, and explain their
answers in an indented body. See [Concept
specification format](reference/concept-specification.md).

Registration and source checking compare machine-readable declaration shape
with TypeScript. Natural-language conditions, effects, and query meaning remain
design contracts and test responsibilities.

## Explicit instances close the selected design

Every configured application variant has a complete `instances` inventory. The
bare form is shorthand for a same-name instance; `instantiate Commenting`
means exactly `instantiate Commenting as Commenting`. A reusable definition may
instead have only renamed instances, and several instances may realize the same
unchanged definition.

```types
concrete Person
  A stable identity supplied by the institution.
```

```instances
instantiate Posting

instantiate Commenting as PostComments with
  User is Person
  Target is Posting.Post
```

Application `types` fences contain only concrete declarations. An inline `with`
block binds each external parameter of that instance directly to either a
concrete type or an owned type of another declared instance. Inline bindings are
the recommended placement because the complete instance is readable in one
place.

Applications that deliberately centralize bindings may detach them:

```instances
instantiate Posting
instantiate Commenting as PostComments
```

```bindings
PostComments.User is Person
PostComments.Target is Posting.Post
```

One instance uses exactly one placement mode: all of its bindings are inline or
all are detached. Detached declarations may be distributed across configured
documents, but inline and detached declarations cannot be mixed for one
instance, and a repeated binding is invalid even when both targets are equal. An
instance whose definition has no external parameters has no binding mode.

The complete configured corpus must declare every selected application instance
exactly once, and every declaration must match the exact assembled variant's
instance and specification-H1 definition. The core-owned `RequestBoundary` is
excluded. Every instance supplies all and only its definition's external
parameters, every instance name is globally unique, and every concrete type is
used.

A binding target is resolved independently. It must be a declared concrete type
or a type that the bounded SSF parser proves is owned by another declared,
selected instance's definition. A target cannot name that instance's external
parameter, so external-to-external aliases and chains remain invalid. Direct
qualified owned-type dependencies may be cyclic: `Alpha.Peer is
Beta.BetaIdentity` and `Beta.Peer is Alpha.AlphaIdentity` are valid when each
named target is independently owned. Declaration order has no meaning.

## Application prose covers executable decisions

Registered composition documents are ordinary Markdown with one nonempty H1. They
have no prescribed heading layout. Authors place typed links beside design claims or
as Markdown citations; under the recommended layout, those claims explain the
application decisions in the paired composition source module:

```md
Editing a post [refreshes its derived content](reaction:Forum.posts.RefreshDerivedContent).
```

The supported destination kinds are `reaction:`, `view:`, `former:`, and
`computation:`. Each destination names exactly one selected declaration; there
are no wildcards or implied descendant links.

Coverage is bidirectional. Every typed link must resolve, every selected authored
reaction tree—including an endpoint tree—must have a reaction link, and every selected
named view and former must have a link of its own kind. The checker does not interpret
the surrounding prose or require one link per sentence. A declaration can have several
references, all retained in read-back.

Each endpoint tree additionally has exactly one declaration in an `endpoints` fence:

```endpoints
Sessions.EnteringApplication.Register at /auth/register
```

The dotted identity must resolve to a selected endpoint and the portable absolute path
must exactly match its `endpoint(...)` path. Different endpoint identities may share a
path. This declaration records the boundary address; it does not replace reaction-link
coverage.

One top-level authored reaction or endpoint tree has one reaction identity even when
lowering produces several runtime stages. Core-generated boundary and outcome reactions
are exempt. Views and formers receive full coverage; there is no helper exemption.

## Stable application identities

Reactions, endpoints, views, and formers use their dotted path in the selected
composition, for example `Forum.posts.RefreshDerivedContent` or
`Forum.feed.HomeFeed`. Path segments begin with a letter or `_` and continue
with letters, digits, `_`, or `-`.

The same declaration object cannot be installed under two paths. Other
constructs may import and use a view or former without reinstalling it.
Independently constructed declarations remain distinct even when their behavior
is similar.

## Computations are application design

Registered application documents, including a dedicated types document, may
contain any number of `computations` fences. There is no required
`computations.md`. A declaration has a signature and a required indented prose
body:

```computations
invitationMailText(invitation: String, credential: String) : String
  Produces the invitation containing the credential and public sign-in URL.
```

Every executable computation has exactly one declaration, and every declaration
names one executable computation. Inputs and optionality must agree. A
`computation:` link elsewhere is optional but must resolve. Computations return
one bare result type; concept action/query rows do not.

## Configurations define variants

Each generated config selects one assembly and its own design corpus:

```text
design: {
  version: 1,
  documents: [
    new URL("./design/types.md", import.meta.url),
    new URL("./design/forum.md", import.meta.url),
  ],
}
```

`documents` contains explicit local `file:` URLs. Documents may be elsewhere in
a monorepo. Any document may contain `types`, `instances`, or `bindings` fences,
and the checker combines declarations across the registered corpus. A
concept-free application, whose assembly contains only the exempt core
`RequestBoundary`, uses `design: { version: 1, documents: [] }`.

A second supported application variant uses a second config. Completeness is
checked independently against the exact assembly returned by each config,
including an advanced `vocabulary(...)` assembly; it is not inferred only from
a syntactically discovered `conceptSet`. Shared documents can be reused only
when their complete instance inventory and every typed reference match that
variant. The checker does not union possible runtime options and defines no
conditional-link syntax.

## Generated evidence and runtime boundaries

Design tooling retains normalized source contents in provenance, so a prose-only
change changes input digests. Generated read-back links to source files and
one-based lines rather than copying application prose. It reports selected
reaction lowering, views, formers, computations, concept signatures, explicit
instance declarations, and resolved external bindings.

The authored inventory is finite and static. Every instance and composition
reference has a fixed name; it does not create instances at runtime, allocate one
instance per tenant or user, provide wildcards or aliases, discover deployments,
or allocate storage.

Distinct names provide distinct authoring and runtime identities within an
assembly, not a durable-isolation proof. Assembly requires a distinct raw
implementation object for each selected name in that assembly, but core cannot
inspect whether those objects share a collection, schema, file, cache namespace,
remote account, or service endpoint. Hosts must choose separate resources when
isolation is required and configure intentional durable sharing explicitly.
The runtime still serializes action bodies only per concept instance within one
assembly. It does not provide transactions across actions, persistence, replay,
distributed serialization, cancellation of accepted work, or exactly-once
execution. Generated TypeScript is not runtime validation. See [Execution
semantics](reference/semantics.md) and [Operational
limits](reference/operations.md) for those boundaries.
