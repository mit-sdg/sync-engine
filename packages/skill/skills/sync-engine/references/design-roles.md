# Independent design roles

The coordinator owns product conversation and prompt construction. A designer owns
the candidate Markdown; a separate critic reviews it. Both roles require native
subagents and normal reasoning.

## Build the closed design context

Read these documents from the exact installed `@mit-sdg/sync-engine` version and
place their exact complete text directly in each applicable role prompt:

- `docs/user/design.md` — generic design guidance;
- `docs/user/reference/concept-specification.md` — exact concept grammar; and
- for the critic, `docs/user/guide/reviewing-a-design.md` — review procedure.

Do not tell a role to discover those documents itself. Add only the current objective,
settled product decisions, explicit non-goals, and the bounded catalog material below.
Do not pass coordinator notes from earlier abandoned designs. Designer and critic
contexts must not contain analysis results, analysis instructions, application
inventory, source attribution, or possible-impact output, and those roles must not
invoke `sync-engine-analysis`.

Use the same-release `@mit-sdg/sync-engine-catalog` (already installed or invoked as
an exact package with Bun) to read `catalog list`, then retrieve selected design bytes
with `catalog show <entry> --raw`. Supply raw Markdown for no more than five concept
designs and two recipes; zero is valid when none is relevant. Do not supply catalog
implementation source during design. State explicitly that catalog entries are
starting points, not required names or contracts: the designer may copy, simplify,
split, combine, rename, or otherwise alter them. Give the critic the same selection,
plus a newly relevant alternative only if the total still respects those bounds.

## Designer contract

Create one native designer subagent with normal reasoning.

| Boundary          | Contract                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Working directory | Exactly the application's `design/` directory                                                         |
| May read          | Any Markdown already under that directory and the closed prompt context                               |
| May write         | Markdown under that directory only                                                                    |
| Must produce      | Complete `concepts/*.md`, `compositions/*.md`, and `types.md` candidate files needed by the objective |
| Must return       | Changed file paths and at most two unresolved product questions, and nothing else                     |

The designer must not inspect application TypeScript, generated files, Git, package
configuration, tests, framework implementation, or framework API documentation. It
must not write `application.md`, a design memo, a critic report, a progress file, or
workflow metadata. One composition document conventionally pairs with one
`src/compositions/*.ts` module; the Markdown places exact reaction, view, former, and
computation links beside the application decisions they realize.

If the designer returns one or two material product questions, ask them in one turn
using the discussion protocol's concrete options and recommended answer for each,
then inject the settled answers back into the same designer before review. Continue
with later one- or two-question turns if the designer identifies further material
questions; there is no cumulative question cap. Never answer a product question by
guessing from implementation source.

## Mechanical syntax pass

After the designer returns, the coordinator enumerates the candidate concept files
and runs the installed core command from the application root:

```sh
bunx sync-engine check-concepts design/concepts/*.md
```

The command is syntax evidence only. Send each diagnostic back to the original
designer subagent. Do not repair the Markdown in coordinator context and do not turn
parser output into a review artifact. A parser failure blocks criticism and
implementation until repaired.

## Critic contract

Once syntax passes, create a fresh native critic subagent with normal reasoning. It
is read-only and receives only the closed design context, exact review guidance, and
the complete candidate Markdown. It must not inspect source, generated files, Git,
package configuration, tests, or framework internals.

The critic returns only material findings, each tied to a candidate file and decision.
It checks the review guide's criteria, including:

- useful capability boundaries, purpose, and principle;
- duplicate authority, peer leakage, and non-opaque external identities;
- reusable capabilities embedded in larger owners;
- unnecessary behavior or complexity outside the objective;
- host or user-interface policy hidden inside domain concepts;
- lifecycle transitions, refusals, repetition, and failure state;
- reaction pressure and cross-concept partial failure;
- composition-document/source-module pairing and exact adjacent links; and
- relevant alternatives from the bounded catalog selection.

It does not edit files or create a persistent report. An empty finding list is a valid
result; the coordinator must not ask the designer to manufacture changes.

## Repair and user review

Return material findings to the original designer subagent. Permit at most two
critic-driven repair turns after the initial candidate. Re-run syntax and use a fresh
read-only criticism of the repaired files when material content changed. If material
findings remain after the second repair, pause and present them to the user as one or
two decision questions per turn, each with concrete options and a recommended answer,
rather than silently accepting them. The critic-driven repair limit does not cap
user-directed discussion or revision rounds.

Present one concise review that links the actual Markdown. Include the objective,
proposed concepts and composition documents, key decisions, important alternatives,
non-goals, unresolved concerns, and a one-line syntax/criticism status. Ask the user
to approve, revise, or discuss as explicit options, and recommend one next action
with a brief reason. If the user chooses revision or discussion, follow the same
interactive one- or two-question turns without a cumulative cap, return settled
changes to the original designer, rerun syntax and fresh criticism, and present the
updated Markdown for approval. Do not include role mechanics or mechanical command
output unless explaining a failure.
