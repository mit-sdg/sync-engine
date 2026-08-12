# Catalog command reference

`@mit-sdg/sync-engine-catalog` exposes only the `catalog` executable. The executable reads assets shipped in its own package. It never writes, installs, locks, generates, inspects a user project, or modifies project files. The package has no runtime import API.

## Commands

```text
catalog list [concept|recipe]
catalog show <entry> [--raw]
catalog source <entry> <selector> [--raw]
catalog help
```

No arguments, `help`, `--help`, and `-h` print usage and exit successfully. Invalid arity, filters, options, entry ids, or source selectors print one error to stderr and exit with status 1 when invoked through the executable.

### `catalog list [concept|recipe]`

Prints one tab-separated record per entry to stdout:

```text
<id>\t<kind>\t<summary>
```

The optional filter is exactly `concept` or `recipe`. Index order is preserved.

### `catalog show <entry> [--raw]`

Without `--raw`, prints entry metadata, the accepted source selectors, and the design asset. The design has explicit `Entry`, `Asset`, and `File` labels followed by `---` and its bytes.

With `--raw`, stdout contains only the design file bytes. This form is intended for redirection and scripts.

### `catalog source <entry> <selector> [--raw]`

Prints exactly one source selected from the list emitted by `show`. Without `--raw`, the output has explicit `Entry`, `Asset`, and `File` labels followed by `---` and the file bytes. With `--raw`, stdout contains only the file bytes.

Recipe selectors are catalog-local file names such as `workshop-selection.ts`. A concept's common source uses its file name; implementation source uses `<implementation>/<file>`, such as `memory/selecting.memory.ts`. Selectors are labels, not destination paths.

## Manifest schema

Every `manifest.json` has `schema: 2`, `id`, `kind`, `summary`, `design`, and `sources`. Unknown fields fail validation. `design` and every source are portable entry-local file names; each declared file must exist and may appear only once in an entry.

A recipe also has `requires`, a list of unique existing entry ids. It describes related concepts for display and does not trigger resolution or output.

A concept also has `implementations`, keyed by lowercase implementation name. Each implementation has a `summary` and `sources`. Implementation metadata exists only to label and select source for display. There is no default implementation.

Manifests do not contain destinations, package requirements, ownership, installation instructions, generated integration, or project configuration.

## Output and side effects

Normal results go to stdout. Executable errors go to stderr. `--raw` emits no labels or metadata. The catalog reads only its packaged index, manifests, and selected assets; it never writes to the current working directory or any user project.

The catalog does not guess whether an asset belongs in `src/vocabulary.ts`, under `src/compositions/`, behind an application's `@design/*` alias, or elsewhere. The user owns that decision and any adaptation required by the application.
