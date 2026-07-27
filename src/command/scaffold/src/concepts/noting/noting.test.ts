import { NotingConcept, NoteNotFound } from "./noting.ts";

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
