# @mit-sdg/sync-engine-analysis

`@mit-sdg/sync-engine-analysis` lists and describes design elements and
contracts, finds related reactions, and traces possible impact. It requires a
host-supplied Application Manifest V5; it neither connects to an application nor
discovers a manifest. Source-aware analysis can add checkout evidence.

## What you can do

- Use `catalog()` to list all concepts, actions, queries, reactions, views,
  formers, computations, and endpoints.
- Use `describe()` to inspect concept, action, query, reaction, and other design
  definitions from the manifest.
- Use `search()` to search identities, raw contract data, and indexed source
  paths.
- Use `impact()` and `navigate()` to trace possible impact and move through
  incoming or outgoing relationships, including reactions that reference an
  action.
- Use `diagnostics()`, `contracts()`, and `provenance()` to inspect findings, raw
  logical endpoint contracts, producer versions, revisions, and file identities.
- Optionally map design elements to checkout source ranges, then read and verify
  the corresponding source bytes.

## Install

Pin analysis and core to the same exact beta:

```sh
bun add --exact @mit-sdg/sync-engine@1.0.0-beta.7 @mit-sdg/sync-engine-analysis@1.0.0-beta.7
```

The ESM package supports Node.js `>=24 <25`. Project analysis depends on
TypeScript `>=6 <7`; importing `/ir` does not load it.

## Choose `/ir` or `/project`

There is no root export from `@mit-sdg/sync-engine-analysis`, and deep imports
are unsupported. Use one of these exact entrypoints:

| Need                                                    | Import                                                                           | Result                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Inspect an existing manifest without source attribution | `@mit-sdg/sync-engine-analysis/ir`                                               | A portable manifest index and query facade. This entrypoint does not evaluate TypeScript, filesystem loaders, or workers. |
| Relate manifest elements to a checkout                  | `@mit-sdg/sync-engine-analysis/project`, then `@mit-sdg/sync-engine-analysis/ir` | A TypeScript-backed project snapshot followed by a source-enriched query facade.                                          |

## Inspect a manifest

Supply an `ApplicationManifestV5` produced by core `applicationManifest()` or
loaded by `parseApplicationManifest()`. Analysis validates but does not search
for it. This example pages through concepts and describes the first definition:

```ts
import { type ApplicationManifestV5 } from "@mit-sdg/sync-engine/tooling";
import { createApplicationAnalysis, type DesignSummary } from "@mit-sdg/sync-engine-analysis/ir";

export async function inspectConcepts(manifest: ApplicationManifestV5): Promise<void> {
  const analysis = createApplicationAnalysis({ manifest });
  const concepts: DesignSummary[] = [];
  let nextOffset: number | null = 0;

  while (nextOffset !== null) {
    const page = await analysis.catalog({
      filters: { kinds: ["concept"] },
      page: { offset: nextOffset, limit: 200 },
    });
    concepts.push(...page.items);
    nextOffset = page.nextOffset;
  }

  for (const concept of concepts) console.log(concept.qualifiedName);

  const first = concepts.at(0);
  if (first !== undefined) {
    const description = await analysis.describe({
      ref: first.ref,
      detail: "definition",
    });
    console.dir(description.definition, { depth: null });
  }
}
```

## Add checkout source evidence

`analyzeApplicationProject()` reads a repository-contained TypeScript project in
a Node worker and produces a metadata-only project snapshot. The `manifest` and
`sourceRevision` arguments below are values the host already has. The revision
identifies the checkout according to the host's own policy.

```ts
import { type ApplicationManifestV5 } from "@mit-sdg/sync-engine/tooling";
import { createApplicationAnalysis } from "@mit-sdg/sync-engine-analysis/ir";
import {
  analyzeApplicationProject,
  applicationProjectAnalysisDigest,
} from "@mit-sdg/sync-engine-analysis/project";

export async function inspectCheckout(
  repositoryRoot: string,
  manifest: ApplicationManifestV5,
  sourceRevision: string,
) {
  const project = await analyzeApplicationProject({
    repositoryRoot,
    tsconfigPath: "tsconfig.json",
    sourceRevision,
    manifest,
    manifestSourceRevision: sourceRevision,
    expectedManifestDigest: manifest.digest,
  });

  const expectedProjectDigest = applicationProjectAnalysisDigest(project);
  return createApplicationAnalysis({
    manifest,
    project,
    expectedProjectDigest,
  });
}
```

Here the host can compute the digest immediately because it produced the
snapshot. For a stored or externally supplied snapshot, pass a previously
trusted digest; hashing the snapshot on receipt does not establish trust.

## Source bytes

Project snapshots store paths, ranges, lengths, byte lengths, and SHA-256
digests, not source text or excerpts.

`readApplicationSourceDocument(sourceIndex, path, { readFile })` asks the caller's
`readFile` function for the complete file. It checks the indexed length, UTF-8
byte length, SHA-256 digest, cancellation, and byte limit before returning the
verified text. Slice an anchor range only after that verification succeeds.

## Persisted formats

| Artifact                  | Persisted format                                     |
| ------------------------- | ---------------------------------------------------- |
| Manifest index            | `sync-engine.application-index` version 2            |
| Possible-impact trace     | `sync-engine.impact-trace` version 2                 |
| Source index              | `sync-engine.application-source-index` version 2     |
| Project analysis snapshot | `sync-engine.application-project-analysis` version 2 |

Facade method results are bounded immutable values, not another persisted
format.

## Important boundaries

- Project analysis reads source as static data. It does not import or execute
  project modules or manifest-producing configuration.
- Source attribution and possible-impact traces are evidence, not proof that a
  behavior will execute. Ambiguous, dynamic, cyclic, and over-limit source flows
  are reported rather than guessed.
- `sourceRevision` and `manifestSourceRevision` are caller assertions. Analysis
  checks that they match but does not inspect Git or prove that a revision names
  the bytes it read.
- A project-backed facade requires a caller-held, previously trusted
  `expectedProjectDigest` for the complete snapshot. Shape validation and
  canonical hashing are not authentication. Hashing attacker-chosen input on
  receipt only chooses to trust that input, and semantic source attribution
  cannot be proved without rerunning TypeScript analysis.
- Graphs, diagnostics, source attribution, AST work, project files and bytes,
  traversals, source reads, pages, and facade result bytes are bounded. Producer
  resource-limit failures return no partial artifact; bounded traversal can
  instead return an explicitly incomplete result.
- `parseApplicationProjectAnalysis()` synchronously consumes its complete input
  string and has no input-size option. Bound untrusted input before calling it.
- The package provides inspection evidence, not workflow, change, coverage,
  authorization, or approval recommendations.

`DEFAULT_ANALYSIS_RESOURCE_LIMITS` contains the producer defaults. See the
[public surface resource table](public-surface.md#producer-resource-limits) for
those defaults, and [facade operation
bounds](public-surface.md#facade-operation-bounds-and-failures) for query and
traversal limits.

## Support and security

Only the newest beta is supported. Keep analysis and core pinned to it and
review the changelog before upgrading. Report vulnerabilities through the
[private reporting process](https://github.com/mit-sdg/sync-engine/blob/main/SECURITY.md).

## Reference

- [Analysis public surface](public-surface.md)
- [sync-engine project overview](https://github.com/mit-sdg/sync-engine/blob/main/README.md)
- [Application model](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/overview.md)
- [Manifest and core tooling API](https://github.com/mit-sdg/sync-engine/blob/main/docs/user/reference/public-api.md#tooling)
- [Support policy](https://github.com/mit-sdg/sync-engine/blob/main/SUPPORT.md)
