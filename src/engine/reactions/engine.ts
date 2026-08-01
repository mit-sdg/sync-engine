/**
 * The engine as a host constructs it directly — the deliberate escape
 * hatches behind `assemble`: instrument concepts by hand, register authored
 * reactions or `ReactionIR`, export or render the application, observe the log,
 * and evaluate formers. Everything else about the interpreter is internal.
 */

import { ActionConcept } from "./runtime/actions.ts";
import { MemoryStore, type LogSink, type RetentionPolicy } from "./runtime/log-store.ts";
import type { Logging } from "./runtime/logging.ts";
import type { EngineObserver } from "./runtime/logging.ts";
import type { ReactionMap } from "./types.ts";
import type { ComputationRef } from "@engine/reads/computations";
import type { FormerRef, FusedFormer } from "@engine/reads/former-nodes";
import type { RelationView } from "@engine/reads/lines";
import type { AppIR, ConceptInventoryIR, FormerIR, ReactionIR, ViewIR } from "@engine/reads/ir";
import { Reacting } from "./runtime/reacting.ts";

export interface Engine {
  /** Instrument every concept in a record, preserving keys. */
  instrument<T extends Record<string, object>>(concepts: T): T;
  /** Instrument a single concept instance. */
  instrument<T extends object>(concept: T): T;
  /** Instrument one concept, optionally under an explicit concept name. */
  instrumentConcept<T extends object>(concept: T, name?: string): T;

  /** Register named reaction functions and lower supported forms to `ReactionIR`. */
  register(reactions: ReactionMap): void;
  /** Install one assembly's vocabulary-owned computations. */
  registerComputations(computations: Record<string, ComputationRef>): void;
  /** Declare views no registered reaction consults, so they export and render with the app. */
  declareViews(...refs: RelationView[]): void;
  /** Declare formers no reaction references — reads served at an edge or a CLI. */
  declareFormers(...refs: FormerRef[]): void;

  /** Register reactions from exported `ReactionIR`; references resolve by name. */
  registerReactions(reactions: ReactionIR[]): void;
  /** Register views from their exported IR, dependencies first. */
  registerViews(views: ViewIR[]): void;
  /** Register formers from their exported IR, dependencies first. */
  registerFormers(formers: FormerIR[]): void;

  /** Everything this engine knows about its registered reactions, as data. */
  exportReactions(): AppIR;
  /** Inventories of every instrumented concept, in instrumentation order. */
  exportConcepts(): ConceptInventoryIR[];
  /** Render the registered application as an assembled read-back. */
  renderApp(title?: string): string;

  /** Register an engine observer. Returns a function to unregister it. */
  addObserver(observer: EngineObserver): () => void;
  /** Remove all registered observers. */
  clearObservers(): void;
  /** Per-action log verbosity. */
  logging: Logging;

  /** Evaluate a fused former against this engine's concepts, at the moment of asking. */
  form<Value>(fused: FusedFormer<Value>): Promise<Value>;
}

export interface EngineOptions {
  retention?: RetentionPolicy;
  logSink?: LogSink;
}

/** Construct an engine with an engine-owned occurrence index. */
export function createEngine(options: EngineOptions = {}): Engine {
  return new Reacting(
    new ActionConcept(new MemoryStore(options.retention ?? "keepAll", options.logSink)),
  );
}
