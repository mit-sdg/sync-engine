/**
 * The engine sends observers one {@link LogEvent} after each instrumented
 * non-query action. The event contains the concept and action names,
 * field-name-redacted input, output, and outcome when present, asking reaction
 * when present, flow, duration, and timestamp. Query methods whose names start
 * with `_` do not emit events. If an observer throws, the engine logs the
 * exception class and continues to the next observer.
 */
import type { ActionOutcome, Mapping } from "./types.ts";

export interface LogEvent {
  concept: string;
  action: string;
  input: Mapping;
  output: Mapping;
  /** The answering posture, when the action answered (result or refusal). */
  outcome?: ActionOutcome;
  /** The reaction that made this ask, if any. */
  by?: string;
  flow: string;
  durationMs: number;
  ts: number;
}

export interface EngineObserver {
  onAction(ev: LogEvent): void;
}
