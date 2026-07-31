import type { Registry } from "@engine/reads/definition-registry";
import type { AppIR, ConceptInventoryIR, ReactionIR, UnloweredIR } from "@engine/reads/ir";
import { renderApp as renderAppSpec } from "@engine/reads/render";
import { serializeFormer } from "@engine/reads/former-lowering";
import { serializeView } from "@engine/reads/view-lowering";
import { readBackApp } from "@engine/reads/read-back";
import { inventoryOf } from "../concepts/introspect.ts";

export function exportReactions(state: {
  loweredReactions: Iterable<ReactionIR[]>;
  unloweredReactions: Iterable<UnloweredIR>;
  registry: Registry;
}): AppIR {
  return {
    reactions: [...state.loweredReactions].flat(),
    views: [...state.registry.viewRefs()].map((ref) => serializeView(ref)),
    formers: [...state.registry.formerRefs()].map((ref) => serializeFormer(ref)),
    unlowered: [...state.unloweredReactions],
  };
}

export function exportConcepts(state: {
  registry: Registry;
  rawConceptOf(instrumented: object): object;
}): ConceptInventoryIR[] {
  const inventories: ConceptInventoryIR[] = [];
  for (const instrumented of state.registry.concepts.values()) {
    const raw = state.rawConceptOf(instrumented);
    inventories.push(inventoryOf(raw));
  }
  return inventories;
}

export function readBack(state: { registry: Registry; exportReactions(): AppIR }): string {
  const app = state.exportReactions();
  return readBackApp(
    app.views,
    app.formers,
    app.reactions,
    app.unlowered,
    state.registry.readBackEnv(),
  );
}

export function renderApp(
  state: {
    registry: Registry;
    rawConceptOf(instrumented: object): object;
    exportReactions(): AppIR;
  },
  title = "Application",
): string {
  return renderAppSpec({
    title,
    concepts: exportConcepts(state),
    app: state.exportReactions(),
  });
}
