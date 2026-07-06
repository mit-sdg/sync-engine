/**
 * Engine observer hook — a passive, non-perturbing subscription point
 * for every (non-query) action the engine executes.
 *
 * A {@link JournalEvent} carries the concept/action names, input, output,
 * flow token, wall-clock duration, and a timestamp.  Observers are pure
 * sinks: they must be cheap and never throw (though the engine guards
 * against throws anyway).
 *
 * **Query actions** (methods whose name starts with `_`) are uninstrumented
 * and do **not** emit events.
 */
import type { Mapping } from "./types.ts";

export interface JournalEvent {
  concept: string;
  action: string;
  input: Mapping;
  output: Mapping;
  flow: string;
  durationMs: number;
  ts: number;
}

export interface EngineObserver {
  onAction(ev: JournalEvent): void;
}
