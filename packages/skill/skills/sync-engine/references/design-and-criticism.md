# Coordinator workflow: design and criticism

Read this on a validated brief. Prompt-building rules here hold for later stages.

## Select compact context

Use only the release-checked catalog executable:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

Every map-designer prompt already carries the catalog listing. After map review, attach
full entries by rule: `show --raw` exactly the entries named in its catalog column.
Catalog designs are alternatives, never mandatory names or contracts. Critics receive no
catalog input. A missing executable fails release check; never replace it.

Build prompts only with `bun "<skill-root>/scripts/command.ts" prompt build`. The compiler
writes them under `.sync-engine/`; pass the reported path without listing that directory.
A budget failure reports source contributions. Tighten context before overriding it.

## Settle decomposition before contracts

Build and launch one fresh map designer through the active harness guide:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role designer --mode map \
  --input brief=product/brief.md
```

It returns only `design/decomposition.md`. Build a fresh tool-free map critic:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role critic --mode map \
  --input brief=product/brief.md --input candidate=design/decomposition.md
```

Every row gets `accept`, `split`, or `merge with <row>`; the map is accepted only when
every verdict is `accept`. Return other verdicts verbatim to the original designer. Two
map reviews are the hard ceiling: after one repair, unresolved boundaries are a product
question. Settle them in the brief and stop rather than launching a third review. Never
write or review concept contracts before map acceptance.

After acceptance, build a contract-phase file and send it to that same designer, never a
fresh one. Include the captured map-critic response and exactly the full catalog entries
named by the map:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role designer --mode contract \
  --input brief=product/brief.md --input map=design/decomposition.md \
  --input review=<map-review-response> --input catalog=<named-entry> ...
```

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

Add `--input blocker=<file>` only when implementation sent the design back. Launch a
fresh tool-free critic for each pass. It sees no earlier report, so the coordinator
recognizes an unchanged finding as the same finding.

Two contract passes are the hard ceiling in every authorization mode:

1. Pass 1 reviews the candidate. `No material findings.` closes criticism.
2. Otherwise send its bullets verbatim plus a neutral repair request to the original
   designer, rerun syntax, and launch fresh pass 2.
3. After pass 2, record all remaining findings in the brief's Open decisions. A blocker
   stops for the user; a nonblocker may proceed only without calling the design clean.

A contract pass never reopens an accepted boundary unless no contract can be written
without moving it; then reopen the map and restart its review sequence. Never defer
missing authority, non-bypassable authorization, ownership, or behavior needed for
visible success. The coordinator never approves its own design.

Interactive work requires explicit implementation approval. Preauthorized work proceeds
when no blocking finding remains; reaching a pass ceiling is never approval.

## Close design identity

After criticism and authorization close, digest authored Markdown once:

```sh
bun "<skill-root>/scripts/command.ts" design digest design
```

Every downstream build carries `--design-root design --design-digest <sha256>`. Any design
change invalidates downstream prompts and conclusions: rerun syntax and applicable fresh
criticism, close authorization again, and take a new digest.
