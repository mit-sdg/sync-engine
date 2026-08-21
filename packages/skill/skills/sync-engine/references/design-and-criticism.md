# Coordinator workflow: design and criticism

Read this on a validated brief. Prompt-building rules here hold for later stages.

## Select compact context

Use only the release-checked catalog executable:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

Every map designer and map critic receives the same compact catalog purpose and operation
cards. After map review, use `show --raw` only for entries marked `catalog-unchanged`;
attach those exact full entries to contract authoring. An adapted entry keeps only the
needed card surface and receives no full contract that could import generic symmetry.
Catalog designs are alternatives, never mandatory names or contracts. A missing
executable fails release check; never replace it.

Build prompts only with `bun "<skill-root>/scripts/command.ts" prompt build`. The compiler
writes them under `.sync-engine/`; pass the reported path without listing that directory.
A budget failure reports source contributions. Never omit required brief or candidate
inputs. If complete contract review cannot fit 48 KiB, stop before authoring contracts
and simplify the accepted map; use a byte override only when the user explicitly accepts
the larger independent review.

## Adopt user-supplied design

When the human supplies authored concept design and says to implement it, preserve it as
authority. Run the syntax check and digest it; do not force it through designer or critic
roles. Build the first implementation prompt with `--user-override`. Its launch record
waives the earlier design phases while retaining all digest, assignment, and validation
checks. Ask for design work only when required authored files are absent or the supplied
design cannot pass syntax.

## Settle decomposition before contracts

Build and launch one fresh map designer through the active harness guide:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role designer --mode map \
  --input brief=product/brief.md
```

It returns only `design/decomposition.md`. Build a fresh prompt-read-only map critic:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role critic --mode map \
  --input brief=product/brief.md --input candidate=design/decomposition.md
```

Every concept row gets `accept`, `split`, or `merge with <row>`. Every brief need gets an
`accept` or `reassign` placement verdict for concept, composition, host, implementation,
or evidence, plus exact authority and obligation blockers. The map is accepted only when
every row and placement is `accept` and no blocker is present. Return every non-accept
verdict and blocker verbatim to the original designer.

Two map reviews are the default ceiling, enforced by the compiler at build, prepare,
launch, and native completion. Pass 2 receives the prior report and focuses on repairs;
it may reopen an earlier decision only for a new material conflict in the revised map.
After one repair, unresolved boundaries are normally a product question. Stop rather
than attempting a third review unless the human user directly requests more review or
authorizes proceeding with `--user-override`.

After acceptance, build a contract-phase delta and continue the same recorded designer,
never a fresh one. The compiler hash-binds but does not resend the brief, accepted map, or
review: that agent already received the brief, authored each map revision, and received
every repair finding. Include full catalog contracts only for `catalog-unchanged` rows:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role designer --mode contract \
  --input brief=product/brief.md --input map=design/decomposition.md \
  --input review=<map-review-response> --input catalog=<named-entry> ...

bun "<skill-root>/scripts/command.ts" launch --role designer \
  --prompt <contract-prompt> --continue-agent <map-designer-id>
```

For a native harness, pass the same `--continue-agent` to `launch prepare`; `launch
complete` rejects another ID. This contract response gets its own prompt, response,
ticket where applicable, and settled record.

The designer writes concept, composition, and types documents and runs its bounded syntax
check. Independently enumerate those files and rerun from application root:

```sh
bunx --no-install sync-engine check-design design/concepts/*.md \
  design/compositions/*.md design/types.md
```

A syntax defect returns to the same designer in a compiler-named diagnostic follow-up.
After one informed repair, recurrence of the same diagnostic signature is a blocker.

## Review authored contracts

Build one contract critic with the brief, accepted map, `types.md`, and every concept and
composition file as repeated candidate inputs. Never aggregate them or split criticism:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role critic --mode contract \
  --input brief=product/brief.md --input candidate=design/decomposition.md \
  --input candidate=design/types.md \
  --input candidate=design/concepts/<name>.md \
  --input candidate=design/compositions/<name>.md
```

Add `--input blocker=<file>` only when implementation sent the design back. The compiler
binds each contract-critic record to the complete candidate design digest. Launch a fresh
prompt-read-only critic for each pass. It sees no earlier report, so the coordinator
recognizes an unchanged finding as the same finding.

Two contract passes are the default ceiling:

1. Pass 1 reviews the candidate. A complete clean `CHECK`/`VERDICT` envelope closes criticism.
2. Otherwise send its bullets verbatim plus a neutral repair request to the original
   designer, rerun syntax, and launch fresh pass 2.
3. After pass 2, record all remaining classified findings in the brief's Open decisions.
   A `BLOCKER` stops for the user; a `MATERIAL-NONBLOCKER` may proceed only without
   calling the design clean. The coordinator never reclassifies a critic finding.

A clean contract response is not a bare sentinel. It carries one auditable `CHECK` line
per map obligation, naming the retry identity, consuming action, and recovery source,
plus a `BRIEF` coverage check before its exact verdict. The compiler rejects an omitted or
duplicate obligation check. A finding response remains classified bullets only.

A contract pass never reopens an accepted boundary unless no contract can be written
without moving it; then reopen the map and restart its review sequence. Never defer
missing authority, non-bypassable authorization, ownership, or behavior needed for
visible success. The coordinator never approves its own design.

Interactive work requires explicit implementation approval. Preauthorized work proceeds
when no blocking finding remains. A direct human instruction may waive any workflow phase
or judgment, adopt supplied authored design, or request another pass with
`--user-override`. Apply the flag to the first prompt that proceeds past the waived work;
its launch record carries the authority forward, and handback lists every earlier missing
phase as user-overridden rather than independently completed or critic-approved. The flag
may also make a contract-designer prompt self-contained for a fresh agent. It never
bypasses hashes, candidate completeness, paths, release compatibility, or another
objective integrity check.

## Close design identity

After criticism and authorization close, digest authored Markdown once; it must equal
the accepted contract critic's candidate digest:

```sh
bun "<skill-root>/scripts/command.ts" design digest design
```

Every downstream build carries `--design-root design --design-digest <sha256>`. Any design
change invalidates downstream prompts and conclusions: rerun syntax and applicable fresh
criticism, close authorization again, and take a new digest.
