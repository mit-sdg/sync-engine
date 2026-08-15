# How sync-engine applications fit together

sync-engine separates reusable concept contracts from the application decisions
that connect them. This page explains those authored contracts, their executable
counterparts, and why design checking occurs in tooling rather than at runtime.
Use [Designing with concepts](design.md) to choose boundaries and [Application
authoring](guide/authoring.md) to create the files.

## Three authored contracts

An application design has three distinct parts:

1. A **concept specification** defines reusable concept-local behavior through
   Purpose, Principle, external Types, raw State, Actions, and Queries.
2. **Application design prose** explains application behavior and links each
   selected reaction, view, and former to the decision it realizes.
3. **Application type declarations** resolve every concept-external type to a
   concrete application type or a type owned by another selected concept.

These parts answer different questions. A concept specification explains a
mechanism without naming an application. Application prose explains why
selected declarations are present. Application type bindings record how otherwise-independent concept parameters
meet in this assembly.

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
`conceptSet` gives each selected instance its application name and returns one
registered concept-set object. Pass that whole object to `assemble` as
`conceptSet`. Its `.concepts` property contains typed declaration references for
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
and Queries sections. Types declares only opaque external parameters. State is
retained raw for provenance but remains unparsed until SSF has a final grammar.
Actions use explicit `where`/`then` branches and terminal returns or refusals;
queries select `one`, `optional`, or `many` and return named rows. See [Concept
specification format](reference/concept-specification.md).

Registration and source checking compare machine-readable declaration shape
with TypeScript. Natural-language conditions, effects, and query meaning remain
design contracts and test responsibilities.

## Application types close external parameters

A `types` fence in any registered application document can contain concrete
types and direct bindings for selected concept instances:

```types
concrete Person
  A stable identity supplied by the institution.

PostComments.User is Person
  Comment authors use institution identities.

PostComments.Target is Posting.Post
  Post comments attach to published posts.
```

`concrete` introduces an application type and requires a prose definition.
`is` binds one selected instance's external parameter directly to either a
concrete type or a type owned by another selected concept instance. Chains,
cycles, bindings to external parameters, missing or duplicate bindings, and
unused concrete types are rejected.

Because State is not parsed, tooling can verify the selected concept on a
qualified target but cannot yet prove that the final type name is state-owned.
It reports no heuristic approximation of that missing proof.

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

Coverage is bidirectional. Every typed link must resolve, every selected
authored reaction tree must have a reaction link, and every selected named view
and former must have a link of its own kind. The checker does not interpret the
surrounding prose or require one link per sentence. A declaration can have
several references, all retained in read-back.

One top-level authored reaction or endpoint tree has one reaction identity even
when lowering produces several runtime stages. Core-generated boundary and
outcome reactions are exempt. Views and formers receive full coverage; there is
no helper exemption.

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
a monorepo. Any document may contain `types` fences, and the checker combines
the declarations across the registered corpus. An application with no
application-level declarations uses `design: { version: 1, documents: [] }`.

A second supported application variant uses a second config. Shared documents
can be reused only when every typed reference resolves in each selected
variant. The checker does not union possible runtime options and defines no
conditional-link syntax.

## Generated evidence and runtime boundaries

Design tooling retains normalized source contents in provenance, so a prose-only
change changes input digests. Generated read-back links to source files and
one-based lines rather than copying application prose. It reports selected
reaction lowering, views, formers, computations, concept signatures and
instances, and resolved application type bindings.

The runtime still serializes action bodies only per concept instance within one
assembly. It does not provide transactions across actions, persistence, replay,
distributed serialization, cancellation of accepted work, or exactly-once
execution. Generated TypeScript is not runtime validation. See [Execution
semantics](reference/semantics.md) and [Operational
limits](reference/operations.md) for those boundaries.
