# Coordinator workflow: design and criticism

Read this on a validated brief. Prompt-building rules here hold for every later stage.

## Select compact context

Use only the release-checked `sync-engine-catalog` executable, without package download:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

Every designer prompt already carries the catalog listing, compiled in rather than
attached, so a design never depends on the coordinator having chosen to supply it. Attach
full entries by rule, never by judgement: `show --raw` exactly the entries the reviewed
map names in its catalog column, and nothing else. Never browse for examples, and add an
unnamed entry only on an explicit user request. Catalog designs are alternatives, never
mandatory names or contracts. The critic template takes no catalog input at all, because a
critic holding entries argues for the catalog's names instead of the brief's mechanisms. A
missing catalog executable must fail release check; never repair, alias, or replace it.

Build prompts only with `bun "<skill-root>/scripts/command.ts" prompt build`. It names and
writes each one under `.sync-engine/`, where every generated prompt, follow-up and
assignment belongs — never under `design/`, which carries design identity. Pass on the
path it reported; listing `.sync-engine` to find a file the compiler just named is spent
context. Put stable role
content before dynamic inputs. A budget failure lists source contributions; tighten
context first and set explicit `--max-bytes` only for legitimate application material.

## Design and criticism

Build the prompt, then launch one fresh designer with the reported prompt path:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role designer \
  --input brief=product/brief.md
bun "<skill-root>/scripts/command.ts" launch --role designer --prompt <prompt-file>
```

`launch` reuses the coordinator's provider, model and reasoning, waits, and writes the
launch record. Later prompt builds require the record for the role before them, so a
stage cannot be skipped by doing its work yourself.

That designer returns `design/decomposition.md` and nothing else. Review the map before
any concept file exists, because that is the last point where moving a boundary costs a
line instead of a rewrite:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role critic \
  --input brief=product/brief.md --input candidate=design/decomposition.md
```

Launch a fresh critic on it, and relay its bullets verbatim to the same designer as the
follow-up that releases it to write concepts. A map review rules on every row rather than
reporting only faults, so it never returns the clean sentinel: the map is clean when every
verdict is accept, and those bullets still go to the designer. Two map
reviews are the ceiling: a map still contested after one repair is a product question,
so settle it in the brief yourself rather than launching a third. Never let the designer
write concept files before a reviewed map, and never review a map that concept files
already depend on — the sequence exists to keep the two decisions apart.

The prompt limits designer writes to its listed `design/` paths; the read-only brief lives
outside them, so `design digest` covers only role-owned design. On at most two material
questions, settle them, update the brief, and send that designer a small answer-only file.

The designer runs its permitted syntax command and repairs syntax before returning.
Independently enumerate draft concept files and rerun the form check from application
root:

```sh
bunx --no-install sync-engine check-design design/concepts/*.md \
  design/compositions/*.md design/types.md
```

Send the same designer one `.sync-engine/` file of at most 4 KiB carrying only check
output, affected paths and repair request; never rebuild or resend the full prompt.

After syntax passes, supply the brief only through its dedicated prompt slot. Pass
the accepted map, `types.md`, and every concept/composition file as repeated
`--input candidate=<path>`
arguments; never aggregate candidate files into an intermediate file. Never split
criticism; one critic sees every candidate, so on overflow raise `--max-bytes` instead:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role critic \
  --input brief=product/brief.md --input candidate=design/decomposition.md \
  --input candidate=design/types.md \
  --input candidate=design/concepts/<name>.md \
  --input candidate=design/compositions/<name>.md
```

Pass `--input blocker=<file>` when an implementation blocker sent the design back, so the
pass is aimed at it. A critic sees only the brief and the candidate files, so it cannot
know what an earlier pass said. Compare passes yourself: a finding the previous pass
already made, still unrepaired, is the same finding and does not buy another pass.

Launch a fresh read-only critic the same way. Two passes are the normal automatic
budget:

1. Critic pass 1 reviews the candidate.
2. No material findings ends criticism immediately.
3. Otherwise return once to the designer. The repair file contains critic bullets
   verbatim and only a neutral resolution request; the coordinator adds no diagnosis,
   interpretation, or proposed repair. Rerun syntax, then launch fresh critic pass 2.

Contract criticism never reopens a boundary the map settled. If a pass reports that a
contract cannot be written without moving one, that is the map being wrong rather than
the concept: reopen `design/decomposition.md`, review it, and rebuild from there.

After pass 2, use the authorization mode:

- **Interactive:** show remaining material findings and stop. “Review more thoroughly”
  authorizes one more designer repair and fresh critic pass; every later pass requires
  another explicit request.
- **Preauthorized:** do not ask permission merely because the count reached two.
  Classify every remaining finding. For any finding that blocks safe coherent implementation or
  brief-visible success and has a conservative resolution from the brief, record the
  assumption, use the same designer to repair, rerun syntax, and launch a fresh critic.
  Continue only for a named blocker with a concrete repair while each pass removes or
  narrows it. Two contract passes is the hard ceiling, map reviews excluded. Past it the
  findings on record were defects in what an earlier pass itself demanded, or belonged to
  implementation rather than design, so a third buys churn. Reaching the ceiling is a
  budget, never an acceptance: record every remaining finding in Open decisions, and if
  any of them blocks, stop and hand them to the user rather than launching again or
  calling the design clean. If the same blocker returns unchanged, stop for the user. A nonblocking
  finding may remain: record it in the brief's Open decisions and final handback, then
  proceed without calling the design clean. Never defer missing authority,
  non-bypassable authorization, ownership, or behavior required for visible success.

Only a material contract mismatch in implementation diagnostics creates a critic pass.
In interactive mode, link the brief and design and require explicit approval; in
preauthorized mode, proceed without an artificial pause once no blocking finding remains. Either mode stops when a
blocking uncertainty has no safe conservative resolution. The coordinator never
approves its own design.

After criticism and authorization close, digest all authored Markdown under `design/`; keep
the digest in active coordinator context. Take it once, here: a digest taken while
criticism is still open is discarded by the next repair.

```sh
bun "<skill-root>/scripts/command.ts" design digest design
```

Every concept, application, frontend, and evidence prompt build requires
`--design-root design` and `--design-digest <sha256>`; the compiler rejects drift. Put
the digest in each temporary assignment. Start every diagnostic follow-up with
`follow-up new --role <role>`, which names it, and verify it with `follow-up check`;
never name one yourself. Any design change invalidates the digest, downstream prompts,
and conclusions: stop downstream work, rerun syntax and fresh criticism as applicable,
complete authorization, and capture a new digest.
