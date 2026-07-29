import { ListenerSet } from "@engine/utils/listener-set";
import { logger } from "@engine/utils/logger";
import { redact, serializeError } from "@engine/utils/redaction";
import type { Redactor } from "@engine/utils/redaction";
import { inspect } from "@engine/utils/runtime";
import type { ActionRecord } from "./actions.ts";
import type { ActionConcept } from "./actions.ts";
import { actionNameOf, conceptNameOf } from "../concepts/introspect.ts";
import type { EngineObserver, LogEvent } from "./observer.ts";
import type { ActionOutcome, Frame } from "../types.ts";
import type { Frames } from "@engine/reads/frames";

export enum Logging {
  OFF,
  TRACE,
  VERBOSE,
}

/** Builds action events, calls observers, and writes interpreter diagnostics. */
export class ReactionLogger {
  private readonly observers = new ListenerSet<EngineObserver>();
  level = Logging.OFF;

  constructor(
    private readonly actions: ActionConcept,
    private readonly redactor: Redactor = { redact },
  ) {}

  addObserver(observer: EngineObserver): () => void {
    return this.observers.add(observer);
  }

  clearObservers(): void {
    this.observers.clear();
  }

  /** Build an observer event with field-name-redacted input, output, and outcome. */
  toEvent(record: ActionRecord, durationMs: number): LogEvent {
    const stored = record.id === undefined ? undefined : this.actions._getById(record.id);
    const sourceOutcome = stored?.outcome ?? record.outcome;
    const outcome =
      sourceOutcome === undefined
        ? undefined
        : (this.redactor.redact(sourceOutcome) as ActionOutcome);
    const by = record.by ?? stored?.by;
    return {
      concept: conceptNameOf(record.concept),
      action: actionNameOf(record.action),
      input: this.redactor.redact(stored?.input ?? record.input) as Record<string, unknown>,
      output: this.redactor.redact(stored?.output ?? record.output ?? {}) as Record<
        string,
        unknown
      >,
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
    this.observers.notify(
      (observer, event) => observer.onAction(event),
      this.toEvent(record, durationMs),
      (error) => logger.warn("observer threw", { error: serializeError(error) }),
    );
  }

  frames(message: string, frames: Frames<Frame>): void {
    if (this.level === Logging.VERBOSE && frames.length > 0) logger.debug(message, { frames });
  }

  action(record: ActionRecord, durationMs?: number): void {
    if (this.level === Logging.VERBOSE) {
      const { concept, input, output, flow, id, outcome } = record;
      logger.debug("Reacting to action:", {
        concept: concept.constructor.name,
        input: this.redactor.redact(input),
        output: this.redactor.redact(output),
        outcome: this.redactor.redact(outcome),
        flow,
        actionId: id,
      });
      return;
    }
    if (this.level === Logging.TRACE) {
      const { concept, action, input, output } = this.toEvent(record, durationMs ?? 0);
      logger.debug(
        `\n${concept}.${action} ${inspect(this.redactor.redact(input))} => ${inspect(this.redactor.redact(output))}\n`,
      );
    }
  }
}
