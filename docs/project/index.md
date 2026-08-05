# Working on sync-engine

Files under `docs/project/` describe changes to the sync-engine repository. They
do not define package behavior and are not included in the published package.
Use the engine-user [documentation map](../user/index.md), [Public
API](../user/reference/public-api.md), and [Execution
semantics](../user/reference/semantics.md) for consumer contracts.

## Start by task

| Task                                       | Start with                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Set up or submit a change                  | [`CONTRIBUTING.md`](../../CONTRIBUTING.md)                              |
| Run a coding agent in this checkout        | [`AGENTS.md`](../../AGENTS.md)                                          |
| Change implementation structure            | [Engine architecture](architecture.md)                                  |
| Change concept-spec parsing or enforcement | [Concept specification processing](concept-specification-processing.md) |
| Prepare or recover a release               | [Contributor release procedure](releasing.md)                           |

## Project document catalog

This catalog is exhaustive for `docs/project/`.

| Path                                                                                      | Class        | Scope                                                              |
| ----------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| [`docs/project/index.md`](index.md)                                                       | Index        | Contributor task and document map                                  |
| [`docs/project/architecture.md`](architecture.md)                                         | Explanation  | Source layout, subsystem ownership, and dependency rules           |
| [`docs/project/concept-specification-processing.md`](concept-specification-processing.md) | Explanation  | Concept-spec parsing, enforcement, data flow, gaps, and extensions |
| [`docs/project/releasing.md`](releasing.md)                                               | How-to guide | Release preparation, publication, and bad-release response         |
