/** Discover executable behavior that cannot travel as portable application data. */

import { asMarker } from "./ir.ts";
import { isPlainObject } from "./matchers.ts";
import { walkValueTree } from "./value-tree.ts";
import type {
  AppIR,
  FormerIR,
  PatternIR,
  ReactionIR,
  TriggerIR,
  UnloweredIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "./ir.ts";
import { foldFormerNode, foldOps, foldReaction, foldView } from "./schema.ts";
import { ordinal } from "@engine/utils/ordinal";

type LocalDefinitionKind = "reaction" | "view" | "former";

interface LocalBehaviorDefinition {
  kind: LocalDefinitionKind;
  name: string;
}

export interface ObservedLocalDefinition extends LocalBehaviorDefinition {
  reasons: readonly string[];
}

type OpaqueOccurrenceKind = "custom" | "identity-pattern" | "unlowered";

interface OpaqueOccurrence {
  definition: LocalBehaviorDefinition;
  kind: OpaqueOccurrenceKind;
  occurrence: number;
  reason: string;
}

interface LocalBehaviorAnalysis {
  localDefinitions: readonly ObservedLocalDefinition[];
  occurrences: readonly OpaqueOccurrence[];
}

export function localDefinitionKey(definition: LocalBehaviorDefinition): string {
  return `${definition.kind}\0${definition.name}`;
}

function compareLocalDefinitions(
  left: LocalBehaviorDefinition,
  right: LocalBehaviorDefinition,
): number {
  return ordinal(localDefinitionKey(left), localDefinitionKey(right));
}

/** Every object-identity `$is` label a pattern mentions, deep. */
function identityLabelsIn(value: unknown, identity: (label: string) => void): void {
  walkValueTree(value, (node) => {
    if (!isPlainObject(node)) return;
    const marker = asMarker(node);
    if (marker?.tag === "$is") identity(String(marker.payload));
  });
}

function triggerPatterns(trigger: TriggerIR): PatternIR[] {
  return trigger.kind === "channel" ? [trigger.pattern] : [trigger.input, trigger.output];
}

/**
 * Walk each definition once. Local occurrences belong to the definition that
 * contains them; references do not duplicate inventory ownership.
 */
export function analyzeLocalBehavior(app: AppIR): LocalBehaviorAnalysis {
  const occurrences: OpaqueOccurrence[] = [];
  const counts = new Map<string, number>();

  const analyzeDefinition = (
    definition: LocalBehaviorDefinition,
    walk: (callbacks: {
      op(op: WhereOpIR | ViewOpIR): void;
      pattern(pattern: PatternIR): void;
      trigger(trigger: TriggerIR): void;
    }) => void,
  ) => {
    const addOccurrence = (kind: OpaqueOccurrenceKind, reason: string) => {
      const key = `${localDefinitionKey(definition)}\0${kind}`;
      const occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);
      occurrences.push({ definition, kind, occurrence, reason });
    };
    const pattern = (mapping: PatternIR) =>
      identityLabelsIn(mapping, (label) =>
        addOccurrence("identity-pattern", `object-identity pattern "${label}"`),
      );
    const trigger = (clause: TriggerIR) => {
      for (const mapping of triggerPatterns(clause)) pattern(mapping);
    };
    walk({
      op(op) {
        if (op.op === "custom") {
          const reason =
            op.fnRef === "<where closure>"
              ? "closure condition"
              : `custom read operation "${op.fnRef}"`;
          addOccurrence("custom", reason);
        }
      },
      pattern,
      trigger,
    });
  };

  const analyzeReaction = (reaction: ReactionIR) =>
    analyzeDefinition({ kind: "reaction", name: reaction.name }, (callbacks) => {
      foldReaction(reaction, callbacks);
    });
  const analyzeView = (view: ViewIR) =>
    analyzeDefinition({ kind: "view", name: view.name }, (callbacks) => {
      foldView(view, callbacks);
    });
  const analyzeFormer = (former: FormerIR) =>
    analyzeDefinition({ kind: "former", name: former.name }, (callbacks) => {
      foldFormerNode(former.body, callbacks);
    });
  const analyzeUnlowered = (reaction: UnloweredIR) =>
    analyzeDefinition({ kind: "reaction", name: reaction.name }, (callbacks) => {
      occurrences.push({
        definition: { kind: "reaction", name: reaction.name },
        kind: "unlowered",
        occurrence: 1,
        reason: `unlowered reaction: ${reaction.reason}`,
      });
      for (const trigger of reaction.known.when) callbacks.trigger(trigger);
      foldOps(reaction.known.where, callbacks);
      for (const consequence of reaction.known.then) {
        callbacks.pattern(consequence.input);
      }
      for (const pattern of reaction.known.patterns) callbacks.pattern(pattern);
    });

  for (const reaction of app.reactions) analyzeReaction(reaction);
  for (const view of app.views) analyzeView(view);
  for (const former of app.formers) analyzeFormer(former);
  for (const reaction of app.unlowered) analyzeUnlowered(reaction);

  const reasons = new Map<string, { definition: LocalBehaviorDefinition; reasons: Set<string> }>();
  for (const occurrence of occurrences) {
    const key = localDefinitionKey(occurrence.definition);
    const entry = reasons.get(key) ?? { definition: occurrence.definition, reasons: new Set() };
    entry.reasons.add(occurrence.reason);
    reasons.set(key, entry);
  }
  const localDefinitions = [...reasons.values()]
    .map(({ definition, reasons: definitionReasons }) => ({
      ...definition,
      reasons: [...definitionReasons].sort(ordinal),
    }))
    .sort(compareLocalDefinitions);

  return {
    localDefinitions,
    occurrences: occurrences.sort((left, right) =>
      ordinal(
        `${localDefinitionKey(left.definition)}\0${left.kind}\0${String(left.occurrence).padStart(8, "0")}`,
        `${localDefinitionKey(right.definition)}\0${right.kind}\0${String(right.occurrence).padStart(8, "0")}`,
      ),
    ),
  };
}
