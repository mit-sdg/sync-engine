import type { Registry } from "@engine/reads/registering";
import type { AppIR, ConceptInventoryIR, ReactionIR } from "@engine/reads/ir";
import { renderApp as renderAppSpec } from "@engine/reads/render";
import { serializeApp, serializeView } from "@engine/reads/lower";
import { readBackApp } from "@engine/reads/read-back";
import type { FusedFormer } from "@engine/reads/former-nodes";
import { isFusedFormer } from "@engine/reads/former-nodes";
import { formTree } from "@engine/reads/former-evaluation";
import { inventoryOf } from "../concepts/introspect.ts";

export function exportReactions(state: {
  loweredReactions: Map<string, ReactionIR[]>;
  unloweredReactions: Map<string, string>;
  registry: Registry;
}): AppIR {
  return serializeApp(
    state.loweredReactions.values(),
    state.unloweredReactions.entries(),
    state.registry.formerRefs(),
    (name) => state.registry.viewNamed(name),
  );
}

export function exportConcepts(state: {
  registry: Registry;
  rawConceptsByInstrumented: WeakMap<object, object>;
}): ConceptInventoryIR[] {
  const inventories: ConceptInventoryIR[] = [];
  for (const instrumented of state.registry.concepts.values()) {
    const raw = state.rawConceptsByInstrumented.get(instrumented) ?? instrumented;
    inventories.push(inventoryOf(raw));
  }
  return inventories;
}

export function readBack(state: { registry: Registry; exportReactions(): AppIR }): string {
  const app = state.exportReactions();
  const views = [...state.registry.viewRefs()].map((ref) => serializeView(ref));
  return readBackApp(views, app.formers, app.reactions, state.registry.readBackEnv());
}

export function renderApp(
  state: {
    registry: Registry;
    rawConceptsByInstrumented: WeakMap<object, object>;
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

export async function form(state: { registry: Registry }, fused: FusedFormer): Promise<unknown> {
  if (!isFusedFormer(fused)) {
    throw new Error(
      "form(...) takes a named former with its input mapping filled, " +
        "for example form(roomDashboard(room)).",
    );
  }
  state.registry.assertFormable(fused.former);
  return formTree(fused, state.registry.readEnv());
}
