# {{heading}}

```sh
bun install
bun run generate    # write generated/{{slug}}.md and generated/wire.ts
bun run check       # check the spec, generated artifacts, and types
bun run principle   # the concept's story, with no application around it
bun run start       # the scenario, through the gateway
```

Use `bun run typecheck`, `bunx sync-engine check`, or
`bunx sync-engine artifacts check` to isolate a failed aggregate check.

Add a behavior by writing `src/concepts/<name>/spec.md`, the class beside it,
and a `registry.ts` that names the Error class for each refusal the
specification declares. Register it in `src/concept-set.ts`, connect it in
`src/composition.ts`, then run `bun run generate && bun run check`.
