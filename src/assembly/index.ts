/** Install a vocabulary and its composition into one coherent running system. */
export { assemble } from "../internal/boundary/assembly-facade.ts";
export type { Assembly, AssemblyOptions } from "../internal/boundary/assembly-facade.ts";
export {
  conceptFloor,
  conceptSet,
  PublicError,
  registerConcept,
} from "../internal/boundary/concept-set.ts";
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
} from "../internal/boundary/concept-set.ts";
export { FileStore, PersistingConcept } from "../internal/hosting/index.ts";
export { MemoryStore } from "../internal/reactions/log-store.ts";
export type { FiringRecord, LogEntry, LogStore } from "../internal/reactions/log-store.ts";
