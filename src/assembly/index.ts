/** Install an application concept set and composition into one coherent running system. */
export { assemble } from "@engine/boundary/assembly/assembly-facade";
export type {
  Assembly,
  ConceptSetAssemblyOptions,
} from "@engine/boundary/assembly/assembly-facade";
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
export { FileLogSink } from "@engine/hosting/file-store";
export { Logging } from "@engine/reactions/runtime/logging";
export type { ExecutionLimits } from "@engine/boundary/invocation/lifecycle";
export type {
  OperationalEvent,
  OperationalObserver,
  OperationalResultClass,
  RawFaultReport,
  RawFaultReporter,
} from "@engine/reactions/runtime/operational";
export type { ActionRefusal } from "@engine/reactions/runtime/instrumenting";
export type { QueryCacheMode } from "@engine/reactions/runtime/instrumenting";
export type {
  FiringRecord,
  IntegrityFailureRecord,
  LogEntry,
  LogSink,
  ReactionFailureRecord,
  RetentionPolicy,
} from "@engine/reactions/runtime/log-store";
