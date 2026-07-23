/** Install a vocabulary and its composition into one coherent running system. */
export { assemble } from "../engine/boundary/assembly-facade.ts";
export type { Assembly, AssemblyOptions } from "../engine/boundary/assembly-facade.ts";
export {
  conceptFloor,
  conceptSet,
  PublicError,
  registerConcept,
} from "../engine/boundary/concept-set.ts";
export type {
  ConceptImplementation,
  ConceptFloor,
  ConceptRegistration,
  ImplementationOverrides,
  Implementations,
  PublicErrorCategory,
  QueryRegistration,
  RefusalRegistration,
  RegisteredConcept,
  RegisteredConceptSet,
} from "../engine/boundary/concept-set.ts";
export { FileStore, PersistingConcept } from "../engine/hosting/index.ts";
export { MemoryStore } from "../engine/reactions/log-store.ts";
export type { FiringRecord, LogEntry, LogStore } from "../engine/reactions/log-store.ts";
