import { assemble } from "@mit-sdg/sync-engine/assembly";
import * as composition from "./composition.ts";
import { {{app}}Concepts, vocabulary } from "./concept-set.ts";

export function assemble{{App}}() {
  return assemble({
    vocabulary,
    instances: {{app}}Concepts.implementations(),
    composition,
  });
}
