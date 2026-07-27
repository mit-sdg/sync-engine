import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { NotingConcept, NoteNotFound } from "./noting.ts";
import spec from "./spec.md" with { type: "text" };

export const noting = registerConcept({
  class: NotingConcept,
  spec,
  refusals: { NOTE_NOT_FOUND: NoteNotFound },
});
