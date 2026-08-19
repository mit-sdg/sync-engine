# Coordinator workflow: design and criticism

Read this on a validated brief. Prompt-building rules here hold for every later stage.

## Select compact context

Default to no catalog context; zero entries is valid. For alternatives, use only the
release-checked `sync-engine-catalog` executable without package download:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

Add one entry only for a named design uncertainty the brief and compact rules leave open;
never browse for examples. At most three concept designs and one recipe; more needs an
explicit user request. Catalog designs are alternatives, never mandatory names or
contracts. A missing catalog executable must fail release check; never repair, alias, or
replace it.

Build prompts only with `bun "<skill-root>/scripts/command.ts" prompt build`. It names and
writes each one under `.sync-engine/`, where every generated prompt, follow-up and
assignment belongs — never under `design/`, which carries design identity. Put stable role
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
`types.md` and every concept/composition file as repeated `--input candidate=<path>`
arguments; never aggregate candidate files into an intermediate file. Never split
criticism; one critic sees every candidate, so on overflow raise `--max-bytes` instead:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role critic \
  --input brief=product/brief.md --input candidate=design/types.md \
  --input candidate=design/concepts/<name>.md \
  --input candidate=design/compositions/<name>.md
```

A critic sees only the brief and the candidate files, so it cannot know what an earlier
pass said. Compare passes yourself: a finding the previous pass already made, still
unrepaired, is the same finding and does not buy another pass.

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
the digest in each temporary assignment. Start every diagnostic follow-up with
`follow-up new --role <role>`, which names it, and verify it with `follow-up check`;
never name one yourself. Any design change invalidates the digest, downstream prompts,
and conclusions: stop downstream work, rerun syntax and fresh criticism as applicable,
complete authorization, and capture a new digest.
