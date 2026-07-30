import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "./spec.md" with { type: "text" };
import { NameTaken, NamingConcept } from "./naming.ts";

export const naming = registerConcept({
  class: NamingConcept,
  spec,
  refusals: { NAME_TAKEN: NameTaken },
});
