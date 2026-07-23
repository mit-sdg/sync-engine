import { logger } from "../utils/logger.ts";
import { redact, serializeError } from "../utils/redaction.ts";
import { inspect } from "../utils/runtime.ts";
import type { ActionRecord } from "./actions.ts";
import type { ActionConcept } from "./actions.ts";
import { actionNameOf, conceptNameOf } from "./introspect.ts";
import type { EngineObserver, LogEvent } from "./observer.ts";
import type { ActionOutcome, Frame } from "./types.ts";
import type { Frames } from "../reads/frames.ts";

export enum Logging {
  OFF,
  TRACE,
  VERBOSE,
}

/** Builds action events, calls observers, and writes interpreter diagnostics. */
export class ReactionLogger {
  readonly observers = new Set<EngineObserver>();
  level = Logging.OFF;

  constructor(private readonly actions: ActionConcept) {}

  addObserver(observer: EngineObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  clearObservers(): void {
    this.observers.clear();
  }

  /** Build an observer event with field-name-redacted input, output, and outcome. */
  toEvent(record: ActionRecord, durationMs: number): LogEvent {
    const stored = record.id === undefined ? undefined : this.actions._getById(record.id);
    const sourceOutcome = stored?.outcome ?? record.outcome;
    const outcome =
      sourceOutcome === undefined ? undefined : (redact(sourceOutcome) as ActionOutcome);
    const by = record.by ?? stored?.by;
    return {
      concept: conceptNameOf(record.concept),
      action: actionNameOf(record.action),
      input: redact(stored?.input ?? record.input) as Record<string, unknown>,
      output: redact(stored?.output ?? record.output ?? {}) as Record<string, unknown>,
      ...(outcome !== undefined ? { outcome } : {}),
      ...(by !== undefined ? { by } : {}),
      flow: record.flow,
      durationMs,
      ts: Date.now(),
    };
  }

  /** Call each observer; log an opaque error class when one throws. */
  emit(record: ActionRecord, durationMs?: number): void {
    if (this.observers.size === 0 || durationMs === undefined) return;
    const event = this.toEvent(record, durationMs);
    for (const observer of this.observers) {
      try {
        observer.onAction(event);
      } catch (error) {
        logger.warn("observer threw", { error: serializeError(error) });
      }
    }
  }

  frames(message: string, frames: Frames<Frame>): void {
    if (this.level === Logging.VERBOSE && frames.length > 0) logger.debug(message, { frames });
  }

  action(record: ActionRecord, durationMs?: number): void {
    if (this.level === Logging.VERBOSE) {
      const { concept, input, output, flow, id, outcome } = record;
      logger.debug("Reacting to action:", {
        concept: concept.constructor.name,
        input: redact(input),
        output: redact(output),
        outcome: redact(outcome),
        flow,
        actionId: id,
      });
      return;
    }
    if (this.level === Logging.TRACE) {
      const { concept, action, input, output } = this.toEvent(record, durationMs ?? 0);
      logger.debug(
        `\n${concept}.${action} ${inspect(redact(input))} => ${inspect(redact(output))}\n`,
      );
    }
  }
}
