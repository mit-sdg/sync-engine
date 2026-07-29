import { Logging } from "@engine/reactions/runtime/logging";
import { Reacting } from "@engine/reactions/runtime/reacting";

/** A fresh engine with observer logging disabled for deterministic tests. */
export function quietReacting(): Reacting {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  return reacting;
}
