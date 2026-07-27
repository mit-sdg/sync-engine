/**
 * **`sync-engine new`** — write a runnable project.
 *
 * The generated project is the smallest complete slice: one concept with its
 * specification, class, registry and principle test; a concept set; a
 * composition holding an endpoint; an assembly; and the config the artifact
 * commands read. It is the same shape the getting-started guide builds, so a
 * reader can continue from either one.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

/** `operations room` and `operations-room` alike become `OperationsRoom`. */
function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

function title(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return name;
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

/** The files a new project starts with, keyed by their path inside it. */
function projectFiles(name: string): Record<string, string> {
  const App = pascal(name);
  const heading = title(name);

  return {
    "package.json": `${JSON.stringify(
      {
        name,
        private: true,
        type: "module",
        scripts: {
          generate: "sync-engine artifacts pin",
          typecheck: "tsc --noEmit",
          principle: "bun src/concepts/noting/noting.test.ts",
          start: "bun src/scenario.ts",
        },
        dependencies: { "@mit-sdg/sync-engine": "latest" },
        devDependencies: { typescript: "^5.9.0" },
      },
      null,
      2,
    )}\n`,

    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ESNext", "DOM"],
          target: "ESNext",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          allowImportingTsExtensions: true,
          noEmit: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ["src", "generated.config.ts", "generated", "*.d.ts"],
      },
      null,
      2,
    )}\n`,

    "text.d.ts": `declare module "*.md" {
  const text: string;
  export default text;
}
`,

    "src/concepts/noting/spec.md": `# Noting

## Purpose

Keep short notes so a thought outlives the moment it arrived in.

## Principle

Ada writes "buy milk" and receives a note. She reads it back by its identity.
Discarding it removes it; discarding it again is refused because it is gone.

## State

\`\`\`state
a set of Notes with
  a text String
\`\`\`

## Actions

\`\`\`actions
write (text: String) : return (note: Note)
  then
    add a new note with text
    return note

discard (note: Note) : return (note: Note)
  where note not in notes
  then
    refuse NOTE_NOT_FOUND "There is no such note."
  where note in notes
  then
    delete note
    return note
\`\`\`

## Queries

\`\`\`queries
_get (note: Note) : optional (text: String)
\`\`\`

Noting does not decide what a note means or who may read it.
`,

    "src/concepts/noting/noting.ts": `export class NoteNotFound extends Error {}

type Note = { note: string; text: string };

/** Keep short notes, each identified on its own. */
export class NotingConcept {
  private readonly notes = new Map<string, Note>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  write({ text }: { text: string }) {
    const note = this.freshID();
    this.notes.set(note, { note, text });
    return { note };
  }

  discard({ note }: { note: string }) {
    if (!this.notes.delete(note)) throw new NoteNotFound();
    return { note };
  }

  _get({ note }: { note: string }): Note[] {
    const found = this.notes.get(note);
    return found === undefined ? [] : [found];
  }
}
`,

    "src/concepts/noting/registry.ts": `import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { NotingConcept, NoteNotFound } from "./noting.ts";
import spec from "./spec.md" with { type: "text" };

export const noting = registerConcept({
  class: NotingConcept,
  spec,
  refusals: { NOTE_NOT_FOUND: NoteNotFound },
});
`,

    "src/concepts/noting/noting.test.ts": `import { NotingConcept, NoteNotFound } from "./noting.ts";

const noting = new NotingConcept(() => "note-1");
const written = noting.write({ text: "buy milk" });

if (noting._get({ note: written.note })[0]?.text !== "buy milk") {
  throw new Error("The note was not found.");
}
noting.discard({ note: written.note });
if (noting._get({ note: written.note }).length !== 0) throw new Error("The note remained.");
try {
  noting.discard({ note: written.note });
  throw new Error("The discarded note was discarded twice.");
} catch (error) {
  if (!(error instanceof NoteNotFound)) throw error;
}
console.log("principle holds");
`,

    "src/concept-set.ts": `import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { noting } from "./concepts/noting/registry.ts";

export const ${App.charAt(0).toLowerCase() + App.slice(1)}Concepts = conceptSet({ Noting: noting });

export const { concepts, vocabulary } = ${App.charAt(0).toLowerCase() + App.slice(1)}Concepts;
`,

    "src/composition.ts": `import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concept-set.ts";

const { Noting } = concepts;

export const notePage = former("the note (note)", ({ note }, { text }) =>
  where(Noting._get({ note }).is({ text })).form({ note, text }),
);

export const WriteNote = endpoint("/notes/write", ({ text, note }) =>
  receive({ text }).then(Noting.write({ text }).responds({ note })).then(respond({ note })),
);

export const GetNote = endpoint("/notes/get", ({ note }) =>
  receive({ note }).then(respond({ page: notePage({ note }) })),
);
`,

    "src/assembly.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import * as composition from "./composition.ts";
import { ${App.charAt(0).toLowerCase() + App.slice(1)}Concepts, vocabulary } from "./concept-set.ts";

export function assemble${App}() {
  return assemble({
    vocabulary,
    instances: ${App.charAt(0).toLowerCase() + App.slice(1)}Concepts.implementations(),
    composition,
  });
}
`,

    "generated.config.ts": `import { assemble${App} } from "./src/assembly.ts";

export default {
  assemble: assemble${App},
  title: "${heading}",
};
`,

    "src/edge.ts": `import { createGateway } from "@mit-sdg/sync-engine/boundary";
import type { ${App}Wire } from "../generated/wire.ts";
import { assemble${App} } from "./assembly.ts";

export function build${App}() {
  const application = assemble${App}();
  const gateway = createGateway<${App}Wire>({ application });
  return { application, gateway };
}
`,

    "src/scenario.ts": `import { createLocalClient } from "@mit-sdg/sync-engine/client";
import type { ${App}Wire } from "../generated/wire.ts";
import { build${App} } from "./edge.ts";

const { gateway } = build${App}();
const notes = createLocalClient<${App}Wire>({ invoker: gateway });

const written = await notes.notes.write({ text: "buy milk" });
if ("error" in written) throw new Error(String(written.error));
const read = await notes.notes.get({ note: written.note });
if ("error" in read) throw new Error(String(read.error));
console.log(JSON.stringify(read.page));
`,

    "README.md": `# ${heading}

\`\`\`sh
bun install
bun run generate    # write generated/${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md and generated/wire.ts
bun run typecheck
bun run principle   # the concept's story, with no application around it
bun run start       # the scenario, through the gateway
\`\`\`

Add a behavior by writing \`src/concepts/<name>/spec.md\`, the class beside it,
and a \`registry.ts\` that names the Error class for each refusal the
specification declares. Register it in \`src/concept-set.ts\`, connect it in
\`src/composition.ts\`, then run \`bun run generate\`.
`,
  };
}

/** Write a new project into `directory`, refusing to overwrite existing files. */
export async function scaffoldProject(directory: string): Promise<string[]> {
  const root = resolve(process.cwd(), directory);
  const files = projectFiles(basename(root));
  const existing = Object.keys(files).filter((path) => existsSync(resolve(root, path)));
  if (existing.length > 0) {
    throw new Error(
      `${directory} already contains ${existing.join(", ")} — refusing to overwrite.`,
    );
  }
  const written: string[] = [];
  for (const [path, contents] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, contents);
    written.push(path);
  }
  return written;
}
