import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { notifying } from "./concepts/notifying/registry.ts";
import { preferring } from "./concepts/preferring/registry.ts";
import { profiling } from "./concepts/profiling/registry.ts";

export const accountCenterConcepts = conceptSet({
  Profiling: profiling,
  Preferring: preferring,
  Notifying: notifying,
});

export const { concepts, vocabulary } = accountCenterConcepts;
