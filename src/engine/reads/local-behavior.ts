/** Discover local behavior, definition references, and boundary use from application IR. */

import { asMarker } from "./ir.ts";
import type {
  AppIR,
  ConsequenceIR,
  FormerIR,
  PatternIR,
  ReactionIR,
  TriggerIR,
  UnloweredIR,
  ValueIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "./ir.ts";
import { foldFormerNode, foldOps, foldReaction, foldView } from "./schema.ts";
import { ordinal } from "@engine/utils/ordinal";

export type LocalDefinitionKind = "reaction" | "view" | "former";

export interface LocalBehaviorDefinition {
  kind: LocalDefinitionKind;
  name: string;
}

export interface ObservedLocalDefinition extends LocalBehaviorDefinition {
  reasons: readonly string[];
}

export type OpaqueOccurrenceKind = "custom" | "identity-pattern" | "unlowered";

export interface OpaqueOccurrence {
  definition: LocalBehaviorDefinition;
  kind: OpaqueOccurrenceKind;
  occurrence: number;
  reason: string;
}

export interface DefinitionDependency {
  from: LocalBehaviorDefinition;
  to: LocalBehaviorDefinition;
}

export interface LocalBehaviorAnalysis {
  localDefinitions: readonly ObservedLocalDefinition[];
  occurrences: readonly OpaqueOccurrence[];
  dependencies: readonly DefinitionDependency[];
  boundaryReactions: readonly string[];
}

export function localDefinitionKey(definition: LocalBehaviorDefinition): string {
  return `${definition.kind}\0${definition.name}`;
}

export function compareLocalDefinitions(
  left: LocalBehaviorDefinition,
  right: LocalBehaviorDefinition,
): number {
  return ordinal(localDefinitionKey(left), localDefinitionKey(right));
}

function walkValue(
  value: ValueIR,
  identity: (label: string) => void,
  former: (name: string) => void,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) walkValue(entry, identity, former);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const marker = asMarker(value);
  if (marker?.tag === "$is") {
    identity(String(marker.payload));
    return;
  }
  if (marker?.tag === "$former") {
    const payload = marker.payload as { name?: unknown; in?: unknown };
    if (typeof payload.name === "string") former(payload.name);
    if (typeof payload.in === "object" && payload.in !== null) {
      walkPattern(payload.in as PatternIR, identity, former);
    }
    return;
  }
  const entries =
    marker?.tag === "$lit" && typeof marker.payload === "object" && marker.payload !== null
      ? Object.values(marker.payload)
      : Object.values(value);
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null) {
      walkValue(entry as ValueIR, identity, former);
    }
  }
}

function walkPattern(
  pattern: PatternIR,
  identity: (label: string) => void,
  former: (name: string) => void,
): void {
  for (const value of Object.values(pattern)) walkValue(value, identity, former);
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
  const dependencies = new Map<string, DefinitionDependency>();
  const boundaryReactions = new Set<string>();
  const counts = new Map<string, number>();

  const analyzeDefinition = (
    definition: LocalBehaviorDefinition,
    walk: (callbacks: {
      op(op: WhereOpIR | ViewOpIR): void;
      pattern(pattern: PatternIR): void;
      trigger(trigger: TriggerIR): void;
      consequence(consequence: ConsequenceIR): void;
      former(name: string): void;
    }) => void,
  ) => {
    const addDependency = (to: LocalBehaviorDefinition) => {
      const dependency = { from: definition, to };
      dependencies.set(`${localDefinitionKey(definition)}\0${localDefinitionKey(to)}`, dependency);
    };
    const addOccurrence = (kind: OpaqueOccurrenceKind, reason: string) => {
      const key = `${localDefinitionKey(definition)}\0${kind}`;
      const occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);
      occurrences.push({ definition, kind, occurrence, reason });
    };
    const pattern = (mapping: PatternIR) =>
      walkPattern(
        mapping,
        (label) => addOccurrence("identity-pattern", `object-identity pattern "${label}"`),
        (name) => addDependency({ kind: "former", name }),
      );
    const trigger = (clause: TriggerIR) => {
      if (definition.kind === "reaction" && clause.kind === "action") {
        if (clause.concept === "RequestBoundary") boundaryReactions.add(definition.name);
        if (clause.by !== undefined) addDependency({ kind: "reaction", name: clause.by });
      }
      for (const mapping of triggerPatterns(clause)) pattern(mapping);
    };
    const consequence = (entry: ConsequenceIR) => {
      if (definition.kind === "reaction" && entry.concept === "RequestBoundary") {
        boundaryReactions.add(definition.name);
      }
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
        if ("view" in op && typeof op.view === "string") {
          addDependency({ kind: "view", name: op.view });
        }
      },
      pattern,
      trigger,
      consequence,
      former: (name) => addDependency({ kind: "former", name }),
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
      foldFormerNode(former.body, {
        ...callbacks,
        node: (node) => {
          if (node.node === "former") callbacks.former(node.former);
        },
        splice: ({ fragment }) => callbacks.former(fragment),
      });
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
        callbacks.consequence(consequence);
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
    dependencies: [...dependencies.values()].sort((left, right) =>
      ordinal(
        `${localDefinitionKey(left.from)}\0${localDefinitionKey(left.to)}`,
        `${localDefinitionKey(right.from)}\0${localDefinitionKey(right.to)}`,
      ),
    ),
    boundaryReactions: [...boundaryReactions].sort(ordinal),
  };
}

/** Return local definitions reachable from one definition, including itself. */
export function reachableLocalDefinitions(
  analysis: LocalBehaviorAnalysis,
  root: LocalBehaviorDefinition,
): ObservedLocalDefinition[] {
  const local = new Map(
    analysis.localDefinitions.map((definition) => [localDefinitionKey(definition), definition]),
  );
  const dependencies = new Map<string, LocalBehaviorDefinition[]>();
  for (const dependency of analysis.dependencies) {
    const key = localDefinitionKey(dependency.from);
    const targets = dependencies.get(key) ?? [];
    targets.push(dependency.to);
    dependencies.set(key, targets);
  }
  const found = new Map<string, ObservedLocalDefinition>();
  const visited = new Set<string>();
  const visit = (definition: LocalBehaviorDefinition) => {
    const key = localDefinitionKey(definition);
    if (visited.has(key)) return;
    visited.add(key);
    const observed = local.get(key);
    if (observed !== undefined) found.set(key, observed);
    for (const dependency of dependencies.get(key) ?? []) visit(dependency);
  };
  visit(root);
  return [...found.values()].sort(compareLocalDefinitions);
}
