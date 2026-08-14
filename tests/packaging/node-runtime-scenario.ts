import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import { createGateway, endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { createLocalClient } from "@mit-sdg/sync-engine/client";

const specification = `# Noting

## Purpose

Keep short notes.

## Principle

Writing a note returns its identity.

## Types

\`\`\`types
\`\`\`

## State

\`\`\`state
a set of Notes with
  a text String
\`\`\`

## Actions

\`\`\`actions
write(text: String) : return (note: Note)
  where true
  then
    add a new note with text
    return note
\`\`\`

## Queries

\`\`\`queries
\`\`\`
`;

class NotingConcept {
  write(_: { text: string }) {
    return { note: "note-1" };
  }
}

const noting = registerConcept({ class: NotingConcept, spec: specification });
const notingConcepts = conceptSet({ Noting: noting });
const { Noting } = notingConcepts.concepts;

const WriteNote = endpoint("/notes/write", ({ text, note }) =>
  receive({ text }).then(Noting.write({ text }).responds({ note })).then(respond({ note })),
);

type ScenarioWire = {
  "/notes/write": {
    input: { text: string };
    output: { note: string };
    error: { error: "INVALID_INPUT" };
  };
};

const application = assemble({
  vocabulary: notingConcepts.vocabulary,
  instances: notingConcepts.implementations(),
  composition: { WriteNote },
});
const gateway = createGateway<ScenarioWire>({ application });
const client = createLocalClient<ScenarioWire>({ invoker: gateway });
const written = await client.notes.write({ text: "buy milk" });

if ("error" in written || written.note !== "note-1") {
  throw new Error("The compiled public gateway/client scenario failed.");
}
