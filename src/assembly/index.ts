/** Install a vocabulary and its composition into one coherent running system. */
export { assemble } from "@engine/boundary/assembly-facade";
export type { Assembly, AssemblyOptions } from "@engine/boundary/assembly-facade";
export {
  conceptFloor,
  conceptSet,
  PublicError,
  registerConcept,
} from "@engine/boundary/concept-set";
export type {
  ConceptImplementation,
  ConceptFloor,
  ConceptRegistration,
  ImplementationOverrides,
  Implementations,
  PublicErrorCategory,
  RegisteredConcept,
  RegisteredConceptSet,
} from "@engine/boundary/concept-set";
export { FileStore, PersistingConcept } from "@engine/hosting/index";
export { MemoryStore } from "@engine/reactions/log-store";
export type {
  FiringRecord,
  LogEntry,
  LogStore,
  ReactionFailureRecord,
  RetentionPolicy,
} from "@engine/reactions/log-store";
