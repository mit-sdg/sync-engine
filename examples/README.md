# Examples

Choose the example that matches what you want to inspect:

- **See the whole design in one composition module.** The
  [reading circle](reading-circle/README.md) is the smaller assembly. Its
  source map follows the design through the gateway and generated evidence.
- **See the same structure split by responsibility.** The [operations
  room](operations-room/README.md) separates policy, reaction packs, boundary
  declarations, and formers while keeping one assembly file.

Both applications use the generic behaviors under [`concepts/`](concepts/).
That directory is the manifest of individual concept specifications; its
[authoring map](concepts/README.md) explains the folder contract and links each
specification. The scenarios and principle tests use
[`support/identities.ts`](support/identities.ts) when their output needs stable
generated identities.

[`text.d.ts`](text.d.ts) lets TypeScript import each concept's `spec.md` as a
string. Applications that import Markdown specifications need the same ambient
`*.md` declaration in their TypeScript project, or an equivalent declaration
from their build tool.
