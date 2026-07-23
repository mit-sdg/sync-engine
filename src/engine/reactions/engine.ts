/**
 * The engine as a host constructs it directly — the deliberate escape
 * hatches behind `assemble`: instrument concepts by hand, register authored
 * reactions or `ReactionIR`, export or render the application, observe the log,
 * and evaluate formers. Everything else about the interpreter is internal.
 */

import { ActionConcept } from "./actions.ts";
import type { LogStore } from "./log-store.ts";
import type { Logging } from "./logging.ts";
import type { EngineObserver } from "./observer.ts";
import type { ReactionMap } from "./types.ts";
import type { ComputationRef } from "../reads/computations.ts";
import type { FormerRef, FusedFormer } from "../reads/former-nodes.ts";
import type { RelationView } from "../reads/lines.ts";
import type { AppIR, ConceptInventoryIR, FormerIR, ReactionIR, ViewIR } from "../reads/ir.ts";
import { Reacting } from "./reacting.ts";

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
  form(fused: FusedFormer): Promise<unknown>;
}

/** Construct an engine with an optional log store. */
export function createEngine(store?: LogStore): Engine {
  return new Reacting(new ActionConcept(store));
}
