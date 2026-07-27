/** Install a vocabulary and its composition into one coherent running system. */
export { assemble } from "@engine/boundary/assembly/assembly-facade";
export type { Assembly, AssemblyOptions } from "@engine/boundary/assembly/assembly-facade";
export {
  conceptFloor,
  conceptSet,
  PublicError,
  registerConcept,
} from "@engine/boundary/assembly/concept-set";
export type {
  ConceptImplementation,
  ConceptFloor,
  ConceptRegistration,
  ImplementationOverrides,
  Implementations,
  PublicErrorCategory,
  RegisteredConcept,
  RegisteredConceptSet,
} from "@engine/boundary/assembly/concept-set";
export { FileStore, PersistingConcept } from "@engine/hosting/index";
export { MemoryStore } from "@engine/reactions/runtime/log-store";
export { Logging } from "@engine/reactions/runtime/logging";
export type { ActionRefusal } from "@engine/reactions/runtime/instrumenting";
export type {
  FiringRecord,
  LogEntry,
  LogStore,
  ReactionFailureRecord,
  RetentionPolicy,
} from "@engine/reactions/runtime/log-store";
