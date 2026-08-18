# Coordinator workflow: design and criticism

Read this on a validated brief. Prompt-building rules here hold for every later stage.

## Select compact context

Default to no catalog context; zero entries is valid. For relevant alternatives, use only the release-checked `sync-engine-catalog`
executable without package download:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

Add one entry only for a named design uncertainty unresolved by the brief and compact
rules; never browse for examples. At most three concept designs and one recipe; more requires explicit user request. Catalog designs are alternatives, never mandatory
names or contracts. A missing catalog executable must fail release check; never repair,
alias, or replace it.

Build prompts only with `bun "<skill-root>/scripts/command.ts" prompt build` and deliver
the reported file through the selected harness guide. The compiler names and writes it
under `.sync-engine/`; every generated prompt, follow-up, and assignment belongs there
and never under `design/`, which carries design identity. Put stable role content before
dynamic inputs. A budget failure lists source contributions; tighten context first and
set explicit `--max-bytes` only for legitimate application material.

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

The prompt limits designer writes to its listed `design/` paths; the brief is read-only
and lives outside them, so `design digest` covers only role-owned design. If it returns at most two material questions, settle them, update the brief, and send the
same designer a small answer-only file.

The designer runs its permitted syntax command and repairs syntax before returning. Independently enumerate
draft concept files and rerun the installed design form check from application root:

```sh
bunx --no-install sync-engine check-design design/concepts/*.md \
  design/compositions/*.md design/types.md
```

Send the same designer one `.sync-engine/` file of at most 4 KiB containing only check
output, affected paths, and repair request. Deliver it through the harness; do not rebuild or resend the
full designer prompt.

After syntax passes, supply the brief only through its dedicated prompt slot. Pass
`types.md` and every concept/composition file as repeated `--input candidate=<path>`
arguments; never aggregate candidate files into an intermediate file. Never split
criticism; one critic sees every candidate, so on overflow raise `--max-bytes` instead:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role critic \
  --input brief=product/brief.md --input candidate=design/types.md \
  --input candidate=design/concepts/<name>.md \
  --input candidate=design/compositions/<name>.md
```

Launch a fresh read-only critic the same way. Two passes are the normal automatic
budget:

1. Critic pass 1 reviews the candidate.
2. No material findings ends criticism immediately.
3. Otherwise return once to the designer. The repair file contains critic bullets
   verbatim and only a neutral resolution request; the coordinator adds no diagnosis,
   interpretation, or proposed repair. Rerun syntax, then launch fresh critic pass 2.

After pass 2, use the authorization mode:

- **Interactive:** show remaining material findings and stop. “Review more thoroughly”
  authorizes one more designer repair and fresh critic pass; every later pass requires
  another explicit request.
- **Preauthorized:** do not ask permission merely because the count reached two.
  Classify every remaining finding. For any finding that blocks safe coherent implementation or
  brief-visible success and has a conservative resolution from the brief, record the
  assumption, use the same designer to repair, rerun syntax, and launch a fresh critic.
  Continue only for a named blocker with a concrete repair while each pass removes or
  narrows it. If the same blocker returns unchanged, stop for the user. A nonblocking
  finding may remain: record it in the brief's Open decisions and final handback, then
  proceed without calling the design clean. Never defer missing authority,
  non-bypassable authorization, ownership, or behavior required for visible success.

Only a material contract mismatch in implementation diagnostics creates a critic pass.
In interactive mode, link the brief and design and require explicit approval; in
preauthorized mode, proceed without an artificial pause once no blocking finding remains. Either mode stops when a
blocking uncertainty has no safe conservative resolution. The coordinator never
approves its own design.

After criticism and authorization close, digest all authored Markdown under `design/`; keep
the digest in active coordinator context:

```sh
bun "<skill-root>/scripts/command.ts" design digest design
```

Every concept, application, frontend, and evidence prompt build requires
`--design-root design` and `--design-digest <sha256>`; the compiler rejects drift. Put
the digest in each temporary assignment and verify it before every diagnostic follow-up
with `follow-up check`. Any design change invalidates the digest, downstream prompts,
and conclusions: stop downstream work, rerun syntax and fresh criticism as applicable,
complete authorization, and capture a new digest.
