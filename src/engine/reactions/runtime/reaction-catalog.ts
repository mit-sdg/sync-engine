/** Own executable reactions, exported definitions, and their trigger indexes. */

import type { ReactionIR, UnloweredIR } from "@engine/reads/ir";
import { setOwn } from "@engine/utils/own-property";
import type { ChannelPosture, ExecutableReaction, InstrumentedAction } from "../types.ts";

export class ReactionCatalog {
  readonly reactions: Record<string, ExecutableReaction> = {};
  readonly reactionsByAction = new Map<InstrumentedAction, Set<ExecutableReaction>>();
  readonly reactionsByChannel = new Map<ChannelPosture, Set<ExecutableReaction>>();
  private readonly loweredByBase = new Map<string, ReactionIR[]>();
  private readonly unloweredByName = new Map<string, UnloweredIR>();
  private readonly namesByBase = new Map<string, string[]>();

  ownerOf(name: string): string | undefined {
    for (const [base, names] of this.namesByBase) {
      if (names.includes(name)) return base;
    }
    return undefined;
  }

  unregisterBase(base: string): void {
    for (const reactionName of this.namesByBase.get(base) ?? []) {
      if (!Object.hasOwn(this.reactions, reactionName)) continue;
      const old = this.reactions[reactionName];
      for (const clause of old.when) {
        if ("channel" in clause) this.reactionsByChannel.get(clause.channel)?.delete(old);
        else this.reactionsByAction.get(clause.action)?.delete(old);
      }
      delete this.reactions[reactionName];
      this.unloweredByName.delete(reactionName);
    }
    this.namesByBase.delete(base);
    this.loweredByBase.delete(base);
  }

  index(reaction: ExecutableReaction): void {
    setOwn(this.reactions, reaction.name, reaction);
    for (const clause of reaction.when) {
      if ("channel" in clause) {
        let indexed = this.reactionsByChannel.get(clause.channel);
        if (indexed === undefined) {
          indexed = new Set();
          this.reactionsByChannel.set(clause.channel, indexed);
        }
        indexed.add(reaction);
      } else {
        let indexed = this.reactionsByAction.get(clause.action);
        if (indexed === undefined) {
          indexed = new Set();
          this.reactionsByAction.set(clause.action, indexed);
        }
        indexed.add(reaction);
      }
    }
  }

  finishBase(base: string, names: string[], lowered: ReactionIR[]): void {
    if (lowered.length > 0) this.loweredByBase.set(base, lowered);
    this.namesByBase.set(base, names);
  }

  markUnlowered(definition: UnloweredIR): void {
    this.unloweredByName.set(definition.name, definition);
  }

  candidates(
    action: InstrumentedAction,
    posture: ChannelPosture | undefined,
  ): Set<ExecutableReaction> | undefined {
    const byAction = this.reactionsByAction.get(action);
    const byChannel = posture === undefined ? undefined : this.reactionsByChannel.get(posture);
    if (byAction === undefined && (byChannel === undefined || byChannel.size === 0))
      return undefined;
    return new Set([...(byAction ?? []), ...(byChannel ?? [])]);
  }

  loweredGroups(): Iterable<ReactionIR[]> {
    return this.loweredByBase.values();
  }

  unloweredEntries(): Iterable<UnloweredIR> {
    return this.unloweredByName.values();
  }
}
