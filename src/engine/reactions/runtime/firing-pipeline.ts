/**
 * The staged firing flow: match one landed occurrence against a reaction's
 * triggers, filter the matched frames through `where`, then form, ask, and
 * settle each consequence — recording sanitized failures per stage.
 */

import { DESCEND, mapValueTree, mapValueTreeAsync, walkValueTree } from "@engine/reads/value-tree";
import { varKeyOf } from "@engine/reads/frames";
import { Frames } from "@engine/reads/frames";
import { hasMarkerKey, liveOf } from "@engine/reads/ir";
import {
  type FormerRef,
  fuseFormer,
  type FusedFormer,
  isFusedFormer,
} from "@engine/reads/former-nodes";
import { formTree } from "@engine/reads/former-evaluation";
import type { ReadEnv } from "@engine/reads/definition-registry";
import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
import { normalizePromiseLike } from "@engine/utils/promise-like";
import { uuid } from "@engine/utils/runtime";
import { setOwn } from "@engine/utils/own-property";
import { actionNameOf } from "../concepts/introspect.ts";
import {
  actionId,
  actionSettlement,
  byReaction as byAskingReaction,
  flow,
  landing,
} from "../context.ts";
import type { ActionSettlement } from "../context.ts";
import type {
  ActionOutcome,
  ActionPattern,
  ExecutableReaction,
  Frame,
  InstrumentedAction,
  Mapping,
  StepNode,
} from "../types.ts";
import { ActionConcept, type ActionRecord, normalizeOutcome } from "./actions.ts";
import { type FiringBook, type FiringFill } from "./firing.ts";
import { errorOutputFromThrown, reactQuietly } from "./instrumenting.ts";
import type { ReactionFailureRecord } from "./log-store.ts";
import type { ReactionLogger } from "./logging.ts";
import { unifyOutputPattern } from "./matching.ts";
import type { TriggerMatcher } from "./matching.ts";
import { isDeferred, SettlementBook } from "./settlement.ts";

type ActionArguments = Record<string | symbol, unknown>;

interface CapturedTriggers {
  flow: string;
  triggerIds: string[];
  frameTriggerIds: string[][];
}

interface FrameProvenance extends CapturedTriggers {
  triggerSignatures?: Set<string>;
}

/**
 * One reaction's trigger stage: the frames its `when` matched on the landed
 * occurrence, before its conditions are read. A deferred trigger keeps this
 * between settlement frontiers, so the anchor's landing position and bindings
 * outlive the moment it landed.
 */
export interface MatchedTrigger {
  actionSymbols: symbol[];
  frames: Frames;
  provenance: FrameProvenance;
  reaction: ExecutableReaction;
}

interface PreparedFiring extends MatchedTrigger {
  frameTriggerIds: string[][];
}

export class FiringPipeline {
  private readonly settlement = new SettlementBook();

  constructor(
    private readonly matcher: TriggerMatcher,
    private readonly actions: ActionConcept,
    private readonly firingBook: FiringBook,
    private readonly definitions: {
      formerNamed(name: string): FormerRef | undefined;
      readEnv(): ReadEnv;
    },
    private readonly reactionLogger: ReactionLogger,
    private readonly react: (record: ActionRecord, durationMs?: number) => Promise<void>,
    private readonly assertRows: (flow: string, count: number) => void,
    private readonly consumeAction: (flow: string) => boolean,
  ) {}

  async fire(record: ActionRecord, reactions: Iterable<ExecutableReaction>): Promise<void> {
    const prepared: PreparedFiring[] = [];
    for (const reaction of reactions) {
      const matched = this.matchTrigger(record, reaction);
      if (matched === undefined) continue;
      if (isDeferred(reaction)) {
        this.settlement.arm(record.flow, matched);
        continue;
      }
      const firing = await this.qualify(matched);
      if (firing !== undefined) prepared.push(firing);
    }
    for (const firing of prepared) await this.dispatch(firing);
  }

  /**
   * Open settlement frontiers for one flow until none produces a firing.
   *
   * Each frontier qualifies every trigger armed in the flow before dispatching
   * any of their consequences, exactly as one landed occurrence does for its
   * siblings, then lets those consequences and the ordinary cascades they
   * start drain before the next frontier opens. An armed trigger whose
   * conditions do not hold stays eligible for a later frontier. Interpreter or
   * integrity failure stops deferred advancement; the flow finalizes with
   * whatever it has already accepted.
   */
  settle(flowToken: string): void | Promise<void> {
    if (!this.settlement.has(flowToken) || !this.actions._isFlowOutermost(flowToken)) return;
    return this.openFrontiers(flowToken);
  }

  private async openFrontiers(flowToken: string): Promise<void> {
    try {
      while (this.settlement.has(flowToken) && !this.actions._flowFailed(flowToken)) {
        const prepared: PreparedFiring[] = [];
        for (const armed of this.settlement.pending(flowToken)) {
          const firing = await this.qualify(armed);
          if (firing === undefined) continue;
          this.settlement.retire(flowToken, armed);
          prepared.push(firing);
        }
        if (prepared.length === 0) return;
        this.reactionLogger.settlement(flowToken, prepared.length);
        for (const firing of prepared) await this.dispatch(firing);
      }
    } finally {
      this.settlement.discard(flowToken);
    }
  }

  /** Match one reaction's `when` against a landed occurrence. */
  private matchTrigger(
    record: ActionRecord,
    reaction: ExecutableReaction,
  ): MatchedTrigger | undefined {
    let matched: Frames;
    let actionSymbols: symbol[];
    try {
      [matched, actionSymbols] = this.matcher.match(record, reaction);
      this.assertRows(record.flow, matched.length);
    } catch (error) {
      this.failStage(
        reaction,
        record.flow,
        [record.id],
        "trigger",
        "trigger matching failed",
        error,
      );
      return undefined;
    }
    if (matched.length === 0) return undefined;

    this.reactionLogger.frames(`Matched \`reaction\`: ${reaction.name} with \`when\`:`, matched);
    return {
      actionSymbols,
      frames: matched,
      provenance: this.capture(matched, record.flow, actionSymbols),
      reaction,
    };
  }

  /** Read one matched trigger's conditions against current state. */
  private async qualify(matched: MatchedTrigger): Promise<PreparedFiring | undefined> {
    const { actionSymbols, provenance, reaction } = matched;
    let frameTriggerIds = provenance.frameTriggerIds;
    let frames = matched.frames;
    if (reaction.where !== undefined) {
      try {
        const filtered = reaction.where(frames);
        const filteredPromise = normalizePromiseLike(filtered);
        frames = filteredPromise === undefined ? (filtered as Frames) : await filteredPromise;
        if (!(frames instanceof Frames)) {
          throw new TypeError("A reaction where function must return Frames.");
        }
        this.assertRows(provenance.flow, frames.length);
        frameTriggerIds = this.assertProvenance(frames, provenance, actionSymbols);
      } catch (error) {
        this.failStage(
          reaction,
          provenance.flow,
          provenance.triggerIds,
          "where",
          "where condition evaluation failed",
          error,
        );
        return undefined;
      }
      this.reactionLogger.frames("After processing `where`:", frames);
      if (frames.length === 0) return undefined;
    }
    return { actionSymbols, frameTriggerIds, frames, provenance, reaction };
  }

  private async dispatch(prepared: PreparedFiring): Promise<void> {
    const { actionSymbols, frameTriggerIds, frames, provenance, reaction } = prepared;
    const active = frames
      .map((_frame, index) => index)
      .filter(
        (index) =>
          !frameTriggerIds[index]!.some((id) => this.firingBook.hasConsumed(id, reaction.name)),
      );
    if (active.length === 0) return;
    try {
      await this.dispatchFrames(
        new Frames(...active.map((index) => frames[index])),
        reaction,
        actionSymbols,
        provenance,
        active.map((index) => frameTriggerIds[index]!),
      );
    } catch (error) {
      this.failStage(
        reaction,
        provenance.flow,
        provenance.triggerIds,
        "consequence-dispatch",
        "consequence processing failed",
        error,
      );
    }
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

  private async dispatchFrames(
    frames: Frames,
    reaction: ExecutableReaction,
    actionSymbols: symbol[],
    captured: CapturedTriggers,
    triggerIdsByFrame: string[][],
  ): Promise<void> {
    for (const [index, frame] of frames.entries()) {
      const fill: FiringFill = {
        reaction: reaction.name,
        flow: captured.flow,
        whenIds: triggerIdsByFrame[index]!,
        bindings: this.bindingsOf(frame, actionSymbols),
        produced: [],
        marked: false,
      };
      await this.runPipelineForFrame(frame, reaction.then, reaction, fill);
      this.firingBook.record(fill);
    }
  }

  private matchThen(
    then: ActionPattern,
    frame: Frame,
    by?: string,
    authoritativeFlow?: string,
  ): ActionArguments {
    const resolve = (value: unknown): unknown =>
      mapValueTree(value, (node) => {
        const key = varKeyOf(node);
        if (key !== undefined) {
          if (!Object.hasOwn(frame, key)) {
            throw new Error(
              `Then clause references variable ${String(key)} which is not bound in the current frame.`,
            );
          }
          return frame[key];
        }
        if (isFusedFormer(node)) {
          return fuseFormer(node.former, resolve(node.in) as Mapping);
        }
        if (typeof node === "object" && node !== null) {
          if (hasMarkerKey(node, "$former")) {
            const payload = (node as { $former: { name: string; in: Mapping } }).$former;
            const ref =
              (liveOf(node) as FormerRef | undefined) ?? this.definitions.formerNamed(payload.name);
            if (ref === undefined) {
              throw new Error(
                `Then clause references former "${payload.name}", which is not registered.`,
              );
            }
            return fuseFormer(ref, resolve(payload.in) as Mapping);
          }
          if (hasMarkerKey(node, "$lit")) return (node as { $lit: unknown }).$lit;
        }
        return DESCEND;
      });

    const input: ActionArguments = {};
    for (const [key, value] of Object.entries(then.input)) setOwn(input, key, resolve(value));
    input[flow] = authoritativeFlow ?? frame[flow];
    input[actionId] = uuid();
    if (by !== undefined) input[byAskingReaction] = by;
    return input;
  }

  private bindingsOf(frame: Frame, actionSymbols: symbol[]): Record<string, unknown> {
    const reserved = new Set<symbol>([flow, landing, ...actionSymbols]);
    const bindings: Record<string, unknown> = {};
    for (const key of Object.keys(frame)) setOwn(bindings, key, frame[key]);
    for (const key of Object.getOwnPropertySymbols(frame)) {
      if (!reserved.has(key)) setOwn(bindings, key.description ?? String(key), frame[key]);
    }
    return bindings;
  }

  private async runPipelineForFrame(
    frame: Frame,
    nodes: StepNode[],
    reaction: ExecutableReaction,
    fill: FiringFill,
  ): Promise<void> {
    let current = new Frames(frame);
    for (const node of nodes) {
      const next: Frame[] = [];
      for (const currentFrame of current) {
        next.push(...(await this.runStepNode(currentFrame, node, reaction, fill)));
      }
      current = new Frames(...next);
      this.assertRows(fill.flow, current.length);
      if (current.length === 0) break;
    }
  }

  private async runStepNode(
    frame: Frame,
    node: StepNode,
    reaction: ExecutableReaction,
    fill: FiringFill,
  ): Promise<Frames> {
    let matched: ActionArguments;
    try {
      matched = this.matchThen(node.action, frame, reaction.name, fill.flow);
    } catch (error) {
      return this.failStep(
        reaction,
        node,
        fill,
        "consequence-input",
        "consequence input could not be formed from the matched bindings",
        error,
      );
    }

    try {
      matched = await this.resolveFormerInputs(matched);
    } catch (error) {
      return this.landFormingFault(matched, node, reaction, fill, error);
    }
    const id = matched[actionId];
    if (typeof id !== "string") throw new Error("Action produced from `then` is missing an id.");

    const previouslyMarked = fill.marked;
    this.firingBook.mark(fill);
    let output: Record<string, unknown>;
    let settlement: ActionSettlement | undefined;
    matched[actionSettlement] = (next: ActionSettlement) => {
      settlement = next;
    };
    const runThen = node.action.action as unknown as (args: ActionArguments) => Promise<unknown>;
    try {
      output = (await runThen(matched)) as Record<string, unknown>;
    } catch (error) {
      if (settlement !== undefined) {
        fill.produced.push(id);
        logger.error(
          settlement === "fault-recorded"
            ? "Consequence action faulted"
            : "Consequence action failed after its ask was recorded",
          {
            action: actionNameOf(node.action.action as InstrumentedAction),
            actionId: id,
            error: serializeError(error),
          },
        );
        if (settlement !== "fault-recorded") {
          this.recordConsequence(node, fill, "consequence-dispatch", error, id);
        }
        return new Frames();
      }
      logger.error("Consequence action failed before its ask was recorded", {
        action: actionNameOf(node.action.action as InstrumentedAction),
        actionId: id,
        error: serializeError(error),
      });
      this.recordConsequence(node, fill, "consequence-dispatch", error, id);
      if (!previouslyMarked) this.firingBook.unmark(fill);
      return new Frames();
    }
    fill.produced.push(id);

    const stored = this.actions._getById(id);
    const outcome =
      (stored === undefined ? undefined : this.actions._matchingRecord(stored).outcome) ??
      normalizeOutcome(output);
    let childFrames: Frames;
    try {
      childFrames =
        outcome.kind === "error"
          ? new Frames({ ...frame })
          : this.framesWithStepOutput(frame, node.action, outcome);
    } catch (error) {
      return this.failStep(
        reaction,
        node,
        fill,
        "consequence-output",
        "consequence output matching failed",
        error,
        id,
      );
    }
    if (childFrames.length === 0) return childFrames;

    if (node.transform !== undefined) {
      try {
        const transformed = node.transform(childFrames);
        const transformedPromise = normalizePromiseLike(transformed);
        childFrames =
          transformedPromise === undefined ? (transformed as Frames) : await transformedPromise;
        if (!(childFrames instanceof Frames)) {
          throw new TypeError("An ask result transform must return Frames.");
        }
        this.assertCausalFlow(childFrames, fill.flow);
      } catch (error) {
        return this.failStep(
          reaction,
          node,
          fill,
          "result-transform",
          "ask result condition failed",
          error,
          id,
        );
      }
    }
    return outcome.kind === "error" ? new Frames() : childFrames;
  }

  private framesWithStepOutput(
    frame: Frame,
    pattern: ActionPattern,
    outcome: ActionOutcome,
  ): Frames {
    const extended = unifyOutputPattern(outcome, pattern.output ?? {}, frame);
    return extended === undefined ? new Frames() : new Frames(extended);
  }

  /** Log a stage failure and record its sanitized interpreter evidence. */
  private failStage(
    reaction: ExecutableReaction,
    flowToken: string,
    triggerIds: string[],
    stage: ReactionFailureRecord["stage"],
    message: string,
    error: unknown,
    consequence: { action?: string; actionId?: string } = {},
  ): void {
    logger.error(`Reaction "${reaction.name}": ${message}`, {
      ...consequence,
      error: serializeError(error),
    });
    this.actions._recordInterpreterFailure(
      reaction.name,
      flowToken,
      triggerIds,
      stage,
      error,
      consequence,
    );
  }

  private failStep(
    reaction: ExecutableReaction,
    node: StepNode,
    fill: FiringFill,
    stage: ReactionFailureRecord["stage"],
    message: string,
    error: unknown,
    actionIdValue?: string,
  ): Frames {
    this.failStage(reaction, fill.flow, fill.whenIds, stage, message, error, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(actionIdValue !== undefined ? { actionId: actionIdValue } : {}),
    });
    return new Frames();
  }

  private recordConsequence(
    node: StepNode,
    fill: FiringFill,
    stage: ReactionFailureRecord["stage"],
    error: unknown,
    actionIdValue?: string,
  ): void {
    this.actions._recordInterpreterFailure(fill.reaction, fill.flow, fill.whenIds, stage, error, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(actionIdValue !== undefined ? { actionId: actionIdValue } : {}),
    });
  }

  private assertCausalFlow(frames: Frames, expected: string): void {
    for (const frame of frames) {
      if (frame[flow] !== expected) {
        throw new TypeError("A frame transform must preserve the causal flow.");
      }
    }
  }

  private async landFormingFault(
    matched: ActionArguments,
    node: StepNode,
    reaction: ExecutableReaction,
    fill: FiringFill,
    error: unknown,
  ): Promise<Frames> {
    const { [flow]: flowToken, [actionId]: id, [byAskingReaction]: askedBy, ...rest } = matched;
    logger.error(`Reaction "${reaction.name}": consequence input former failed`, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(typeof id === "string" ? { actionId: id } : {}),
      error: serializeError(error),
    });
    const concept = (node.action.action as InstrumentedAction).concept;
    if (typeof id !== "string" || typeof flowToken !== "string" || concept === undefined) {
      return new Frames();
    }
    if (!this.consumeAction(flowToken)) return new Frames();
    const describe = (value: unknown): unknown =>
      mapValueTree(value, (entry) =>
        isFusedFormer(entry)
          ? { $former: { name: entry.former.formerName, in: entry.in } }
          : DESCEND,
      );
    const record: ActionRecord = {
      id,
      action: node.action.action as InstrumentedAction,
      concept,
      input: describe(rest) as Record<string, unknown>,
      flow: flowToken,
      ...(typeof askedBy === "string" ? { by: askedBy } : {}),
    };
    this.firingBook.mark(fill);
    record.input = this.actions._beginMatchingInput({
      id,
      flow: flowToken,
      input: record.input,
    });
    try {
      this.actions.invoke(record);
      this.actions.faulted({ id, fault: errorOutputFromThrown(error), error });
      fill.produced.push(id);
      await reactQuietly(
        { react: this.react, emit: () => {} },
        { ...record },
        0,
        "consequence-input fault",
        { actionId: id },
      );
    } finally {
      this.actions._endMatchingInput(flowToken);
    }
    return new Frames();
  }

  private async resolveFormerInputs(input: ActionArguments): Promise<ActionArguments> {
    let hasFormer = false;
    for (const value of Object.values(input)) {
      walkValueTree(value, (node) => {
        if (!isFusedFormer(node)) return;
        hasFormer = true;
        return false;
      });
      if (hasFormer) break;
    }
    if (!hasFormer) return input;

    const result: ActionArguments = {};
    for (const key of Object.getOwnPropertySymbols(input)) setOwn(result, key, input[key]);
    for (const [key, value] of Object.entries(input)) {
      setOwn(
        result,
        key,
        await mapValueTreeAsync(value, (node) =>
          isFusedFormer(node)
            ? formTree(node as FusedFormer, this.definitions.readEnv(), (count) =>
                this.assertRows(input[flow] as string, count),
              )
            : DESCEND,
        ),
      );
    }
    return result;
  }
}
