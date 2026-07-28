/** Match, filter, and hand one eligible reaction to consequence dispatch. */

import { Frames } from "@engine/reads/frames";
import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
import { flow } from "../context.ts";
import type { ExecutableReaction, Frame } from "../types.ts";
import type { ActionRecord } from "./actions.ts";
import type { CapturedTriggers, ConsequencePipeline } from "./consequence-pipeline.ts";
import type { InterpreterFailures } from "./interpreter-failures.ts";
import type { ReactionLogger } from "./logging.ts";
import type { TriggerMatcher } from "./trigger-matching.ts";

interface FrameProvenance extends CapturedTriggers {
  triggerSignatures?: Set<string>;
}

export class FiringPipeline {
  constructor(
    private readonly matcher: TriggerMatcher,
    private readonly consequences: ConsequencePipeline,
    private readonly failures: InterpreterFailures,
    private readonly reactionLogger: ReactionLogger,
    private readonly assertRows: (flow: string, count: number) => void,
  ) {}

  async fire(record: ActionRecord, reaction: ExecutableReaction): Promise<void> {
    let matched: Frames;
    let actionSymbols: symbol[];
    try {
      [matched, actionSymbols] = this.matcher.match(record, reaction);
      this.assertRows(record.flow, matched.length);
    } catch (error) {
      logger.error(`Reaction "${reaction.name}": trigger matching failed`, {
        error: serializeError(error),
      });
      this.failures.record(
        reaction.name,
        record.flow,
        record.id === undefined ? [] : [record.id],
        "trigger",
        error,
      );
      return;
    }
    if (matched.length === 0) return;

    this.reactionLogger.frames(`Matched \`reaction\`: ${reaction.name} with \`when\`:`, matched);
    const provenance = this.capture(matched, record.flow, actionSymbols);
    let frameTriggerIds = provenance.frameTriggerIds;
    let frames = matched;
    if (reaction.where !== undefined) {
      try {
        const filtered = reaction.where(frames);
        frames = filtered instanceof Promise ? await filtered : filtered;
        if (!(frames instanceof Frames)) {
          throw new TypeError("A reaction where function must return Frames.");
        }
        this.assertRows(provenance.flow, frames.length);
        frameTriggerIds = this.assertProvenance(frames, provenance, actionSymbols);
      } catch (error) {
        logger.error(`Reaction "${reaction.name}": where condition evaluation failed`, {
          error: serializeError(error),
        });
        this.failures.record(reaction.name, provenance.flow, provenance.triggerIds, "where", error);
        return;
      }
      this.reactionLogger.frames("After processing `where`:", frames);
    }
    try {
      await this.consequences.dispatch(
        frames,
        reaction,
        actionSymbols,
        provenance,
        frameTriggerIds,
      );
    } catch (error) {
      logger.error(`Reaction "${reaction.name}": consequence processing failed`, {
        error: serializeError(error),
      });
      this.failures.record(
        reaction.name,
        provenance.flow,
        provenance.triggerIds,
        "consequence-dispatch",
        error,
      );
    }
  }

  async addThen(
    frames: Frames,
    reaction: ExecutableReaction,
    actionSymbols: symbol[],
    captured?: CapturedTriggers,
    validatedTriggerIds?: string[][],
  ): Promise<void> {
    const provenance =
      captured ??
      this.capture(
        frames,
        typeof frames[0]?.[flow] === "string" ? frames[0][flow] : "",
        actionSymbols,
      );
    await this.consequences.dispatch(
      frames,
      reaction,
      actionSymbols,
      provenance,
      validatedTriggerIds ?? provenance.frameTriggerIds,
    );
  }

  private capture(frames: Frames, flowToken: string, actionSymbols: symbol[]): FrameProvenance {
    const frameTriggerIds = frames.map((frame) => this.triggerIdsOf(frame, actionSymbols));
    const triggerIds = [...new Set(frameTriggerIds.flat())];
    return {
      flow: flowToken,
      triggerIds,
      frameTriggerIds,
      ...(actionSymbols.length > 0
        ? { triggerSignatures: new Set(frameTriggerIds.map((ids) => JSON.stringify(ids))) }
        : {}),
    };
  }

  private assertProvenance(
    frames: Frames,
    provenance: FrameProvenance,
    actionSymbols: symbol[],
  ): string[][] {
    const frameTriggerIds: string[][] = [];
    for (const frame of frames) {
      if (frame[flow] !== provenance.flow) {
        throw new TypeError("A frame transform must preserve the causal flow.");
      }
      const triggerIds = this.triggerIdsOf(frame, actionSymbols);
      if (
        provenance.triggerSignatures !== undefined &&
        !provenance.triggerSignatures.has(JSON.stringify(triggerIds))
      ) {
        throw new TypeError("A reaction where function must preserve its trigger occurrences.");
      }
      frameTriggerIds.push(triggerIds);
    }
    return frameTriggerIds;
  }

  private triggerIdsOf(frame: Frame, actionSymbols: symbol[]): string[] {
    return actionSymbols.map((actionSymbol, index) => {
      const id = frame[actionSymbol];
      if (typeof id !== "string") {
        throw new Error(`Matched frame has no action id for trigger ${index + 1}.`);
      }
      return id;
    });
  }
}
