# Independent designer

<!-- include: ../common/design.md -->

## Assignment

Work only from supplied material and Markdown already in application `design/`. The
brief is read-only. Do not inspect TypeScript, generated files, Git, package
configuration, tests, framework source, API docs, or analysis output.

Write only brief-required candidate Markdown:

- reusable contracts in `concepts/*.md`;
- application decisions and exact adjacent typed links in `compositions/*.md`; and
- external bindings in `types.md`.

Do not create an index, `application.md`, memo, report, progress file, or workflow
metadata. Catalog entries are alternatives: copy, simplify, split, combine, rename, or
reject them.

## Concept grammar

Each concept file has one definition-name H1 and these H2s only, in order:

```text
Purpose
Principle
Types
State
Actions
Queries
```

Purpose and Principle are nonempty unfenced prose. Types, Actions, and Queries each
contain one matching fence. State contains one `state` fence and optional concise
invariant prose; version 1 does not parse State.

Types contains only `external Name` declarations, optionally followed by indented
explanation, or is empty. Do not declare other type kinds.

Declare at least one action. Actions use parenthesized named inputs, `: return`,
parenthesized named results, and one or more explicit `where`/`then` branches. Optional
fields use `name?: Type`;
unconditional branches use `where true`. Each branch ends with exactly one `return` or
`refuse CODE "Normative sentence."`; that sentence states the branch rule. Successful
branches return exactly the declared
result names; an empty result is `()` followed by plain `return`.

Action names start with an ASCII letter, queries with `_`, and fields with an ASCII
letter or `_`; later characters may be digits. Names are unique in scope. Queries
return a parenthesized named-row `one`, `optional`, or `many`. Concept files contain
no application links or computations.

## Return

Return changed paths and at most two brief-material questions. Return nothing else; do
not ask about polish or out-of-scope behavior.

## Product brief

<!-- input: brief -->

## Existing design

<!-- input?: existing-design -->

## Selected catalog alternatives

<!-- input?: catalog -->
