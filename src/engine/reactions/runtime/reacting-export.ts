import type { Registry } from "@engine/reads/definition-registry";
import type { AppIR, ConceptInventoryIR, ReactionIR, UnloweredIR } from "@engine/reads/ir";
import { renderApp as renderAppSpec } from "@engine/reads/render";
import { serializeApp } from "@engine/reads/application-lowering";
import { serializeView } from "@engine/reads/view-lowering";
import { readBackApp } from "@engine/reads/read-back";
import { inventoryOf } from "../concepts/introspect.ts";

export function exportReactions(state: {
  loweredReactions: Iterable<ReactionIR[]>;
  unloweredReactions: Iterable<UnloweredIR>;
  registry: Registry;
}): AppIR {
  const app = serializeApp(
    state.loweredReactions,
    state.unloweredReactions,
    state.registry.formerRefs(),
    (name) => state.registry.viewNamed(name),
  );
  return {
    ...app,
    views: [...state.registry.viewRefs()].map((ref) => serializeView(ref)),
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
  const views = [...state.registry.viewRefs()].map((ref) => serializeView(ref));
  return readBackApp(
    views,
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
