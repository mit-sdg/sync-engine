/** Form, ask, and settle each consequence in a matched reaction pipeline. */

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
import type { ReadEnv } from "@engine/reads/env";
import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
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
import { type FiringBook, type FiringBranch, type FiringFill } from "./firing.ts";
import { errorOutputFromThrown } from "./instrumenting.ts";
import type { InterpreterFailures } from "./interpreter-failures.ts";
import type { ReactionFailureRecord } from "./log-store.ts";
import { unifyOutputPattern } from "./matching.ts";

type ActionArguments = Record<string | symbol, unknown>;

export interface CapturedTriggers {
  flow: string;
  triggerIds: string[];
  frameTriggerIds: string[][];
}

export class ConsequencePipeline {
  constructor(
    private readonly actions: ActionConcept,
    private readonly firingBook: FiringBook,
    private readonly definitions: {
      formerNamed(name: string): FormerRef | undefined;
      readEnv(): ReadEnv;
    },
    private readonly failures: InterpreterFailures,
    private readonly react: (record: ActionRecord, durationMs?: number) => Promise<void>,
    private readonly assertRows: (flow: string, count: number) => void,
  ) {}

  async dispatch(
    frames: Frames,
    reaction: ExecutableReaction,
    actionSymbols: symbol[],
    captured: CapturedTriggers,
    triggerIdsByFrame: string[][],
  ): Promise<void> {
    for (const [index, frame] of frames.entries()) {
      const whenIds = triggerIdsByFrame[index];
      if (whenIds === undefined) {
        const error = new Error("Matched frame has no captured trigger occurrences.");
        logger.warn(
          `Reaction "${reaction.name}": matched bindings could not resolve every trigger occurrence`,
          { error: serializeError(error) },
        );
        this.failures.record(reaction.name, captured.flow, captured.triggerIds, "trigger", error);
        continue;
      }
      const fill: FiringFill = {
        reaction: reaction.name,
        flow: captured.flow,
        whenIds,
        bindings: this.bindingsOf(frame, actionSymbols),
        produced: [],
        branches: [],
      };
      await this.runPipelineForFrame(
        frame,
        reaction.then,
        reaction,
        this.firingBook.newBranch(fill),
      );
      this.firingBook.record(fill);
    }
  }

  matchThen(
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
    branch: FiringBranch,
  ): Promise<Frames> {
    let current = new Frames(frame);
    for (const node of nodes) {
      const next: Frame[] = [];
      for (const currentFrame of current) {
        const result = await this.runStepNode(currentFrame, node, reaction, branch);
        if (!result.stop) next.push(...result.frames);
      }
      current = new Frames(...next);
      this.assertRows(branch.fill.flow, current.length);
      if (current.length === 0) break;
    }
    return current;
  }

  private async runStepNode(
    frame: Frame,
    node: StepNode,
    reaction: ExecutableReaction,
    branch: FiringBranch,
  ): Promise<{ frames: Frames; stop: boolean }> {
    let matched: ActionArguments;
    try {
      matched = this.matchThen(node.action, frame, reaction.name, branch.fill.flow);
    } catch (error) {
      return this.failStep(
        reaction,
        node,
        branch,
        "consequence-input",
        "consequence input could not be formed from the matched bindings",
        error,
      );
    }

    try {
      matched = await this.resolveFormerInputs(matched);
    } catch (error) {
      return this.landFormingFault(matched, node, reaction, branch, error);
    }
    const id = matched[actionId];
    if (typeof id !== "string") throw new Error("Action produced from `then` is missing an id.");

    this.firingBook.mark(branch);
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
        branch.fill.produced.push(id);
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
          this.recordStepFailure(reaction, node, branch, "consequence-dispatch", error, id);
        }
        return this.stopped();
      }
      logger.error("Consequence action failed before its ask was recorded", {
        action: actionNameOf(node.action.action as InstrumentedAction),
        actionId: id,
        error: serializeError(error),
      });
      this.recordStepFailure(reaction, node, branch, "consequence-dispatch", error, id);
      this.firingBook.unmark(branch);
      return this.stopped();
    }
    branch.fill.produced.push(id);

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
        branch,
        "consequence-output",
        "consequence output matching failed",
        error,
        id,
      );
    }
    if (childFrames.length === 0) return { frames: childFrames, stop: true };

    if (node.transform !== undefined) {
      try {
        const transformed = node.transform(childFrames);
        childFrames = transformed instanceof Promise ? await transformed : transformed;
        if (!(childFrames instanceof Frames)) {
          throw new TypeError("An ask result transform must return Frames.");
        }
        this.assertCausalFlow(childFrames, branch.fill.flow);
      } catch (error) {
        return this.failStep(
          reaction,
          node,
          branch,
          "result-transform",
          "ask result condition failed",
          error,
          id,
        );
      }
    }
    return { frames: childFrames, stop: outcome.kind === "error" };
  }

  private framesWithStepOutput(
    frame: Frame,
    pattern: ActionPattern,
    outcome: ActionOutcome,
  ): Frames {
    if (pattern.output === undefined) return new Frames({ ...frame });
    const extended = unifyOutputPattern(outcome, pattern.output, frame);
    return extended === undefined ? new Frames() : new Frames(extended);
  }

  private failStep(
    reaction: ExecutableReaction,
    node: StepNode,
    branch: FiringBranch,
    stage: ReactionFailureRecord["stage"],
    message: string,
    error: unknown,
    actionIdValue?: string,
  ): { frames: Frames; stop: true } {
    logger.error(`Reaction "${reaction.name}": ${message}`, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(actionIdValue !== undefined ? { actionId: actionIdValue } : {}),
      error: serializeError(error),
    });
    this.recordStepFailure(reaction, node, branch, stage, error, actionIdValue);
    return this.stopped();
  }

  private recordStepFailure(
    reaction: ExecutableReaction,
    node: StepNode,
    branch: FiringBranch,
    stage: ReactionFailureRecord["stage"],
    error: unknown,
    actionIdValue?: string,
  ): void {
    this.failures.record(reaction.name, branch.fill.flow, branch.fill.whenIds, stage, error, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(actionIdValue !== undefined ? { actionId: actionIdValue } : {}),
    });
  }

  private stopped(): { frames: Frames; stop: true } {
    return { frames: new Frames(), stop: true };
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
    branch: FiringBranch,
    error: unknown,
  ): Promise<{ frames: Frames; stop: boolean }> {
    const { [flow]: flowToken, [actionId]: id, [byAskingReaction]: askedBy, ...rest } = matched;
    logger.error(`Reaction "${reaction.name}": consequence input former failed`, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(typeof id === "string" ? { actionId: id } : {}),
      error: serializeError(error),
    });
    const concept = (node.action.action as InstrumentedAction).concept;
    if (typeof id !== "string" || typeof flowToken !== "string" || concept === undefined) {
      return this.stopped();
    }
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
    this.firingBook.mark(branch);
    this.actions._beginMatchingInput({ id, flow: flowToken, input: record.input });
    try {
      this.actions.invoke(record);
      this.actions.faulted({ id, fault: errorOutputFromThrown(error) });
      branch.fill.produced.push(id);
      try {
        await this.react({ ...record }, 0);
      } catch (immediateError) {
        logger.error("Reaction body failed after a consequence-input fault was recorded", {
          actionId: id,
          error: serializeError(immediateError),
        });
      }
    } finally {
      this.actions._endMatchingInput(flowToken);
    }
    return this.stopped();
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
          isFusedFormer(node) ? formTree(node as FusedFormer, this.definitions.readEnv()) : DESCEND,
        ),
      );
    }
    return result;
  }
}
