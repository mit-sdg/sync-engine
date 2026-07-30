/** Install a vocabulary and its composition into one coherent running system. */
export { assemble } from "@engine/boundary/assembly/assembly-facade";
export type { Assembly, AssemblyOptions } from "@engine/boundary/assembly/assembly-facade";
export { conceptFloor, conceptSet, registerConcept } from "@engine/boundary/assembly/concept-set";
export type {
  ConceptImplementation,
  ConceptFloor,
  ConceptRegistration,
  ImplementationOverrides,
  Implementations,
  RegisteredConcept,
  RegisteredConceptSet,
} from "@engine/boundary/assembly/concept-set";
export { FileStore } from "@engine/hosting/file-store";
export { MemoryStore } from "@engine/reactions/runtime/log-store";
export { Logging } from "@engine/reactions/runtime/logging";
export type { ExecutionLimits } from "@engine/boundary/invocation/lifecycle";
export type {
  OperationalEvent,
  OperationalObserver,
  OperationalResultClass,
} from "@engine/reactions/runtime/operational";
export type { ActionRefusal } from "@engine/reactions/runtime/instrumenting";
export type {
  FiringRecord,
  IntegrityFailureRecord,
  LogEntry,
  LogStore,
  ReactionFailureRecord,
  RetentionPolicy,
} from "@engine/reactions/runtime/log-store";
