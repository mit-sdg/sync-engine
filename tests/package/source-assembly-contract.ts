import { assemble, conceptSet, Logging, registerConcept } from "@sync-engine/assembly";
import type { ActionRefusal, AssemblyOptions } from "@sync-engine/assembly";
import type { GatewayOptions } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/language";

class FirstConcept {}
class SecondConcept {}

const spec = "# Concept";
const context = { store: "primary" };

const complete = conceptSet({
  First: registerConcept({
    class: FirstConcept,
    spec,
    floors: {
      mongo: (_: typeof context) => new FirstConcept(),
      file: (_: typeof context) => new FirstConcept(),
    },
  }),
  Second: registerConcept({
    class: SecondConcept,
    spec,
    floors: { mongo: (_: typeof context) => new SecondConcept() },
  }),
});

complete.implementations();
complete.implementations("mongo", context);

const combinedContext = conceptSet({
  First: registerConcept({
    class: FirstConcept,
    spec,
    floors: { shared: (_: { store: string }) => new FirstConcept() },
  }),
  Second: registerConcept({
    class: SecondConcept,
    spec,
    floors: { shared: (_: { url: URL }) => new SecondConcept() },
  }),
});
combinedContext.implementations("shared", {
  store: "primary",
  url: new URL("https://example.test"),
});

// @ts-expect-error One context must satisfy every factory on the selected floor.
combinedContext.implementations("shared", { store: "primary" });

// @ts-expect-error A floor declared by only one registration is not a complete named floor.
complete.implementations("file", context);

const incomplete = conceptSet({
  First: registerConcept({
    class: FirstConcept,
    spec,
    floors: { mongo: (_: typeof context) => new FirstConcept() },
  }),
  Second: registerConcept({ class: SecondConcept, spec }),
});

incomplete.implementations();

// @ts-expect-error A named floor is available only when every registration declares it.
incomplete.implementations("mongo", context);

class SynchronousActionConcept {
  constructor(readonly prefix = "") {}

  save({ value }: { value: string }) {
    return { value: `${this.prefix}${value}` };
  }

  _saved(_: Record<string, never>): { value: string }[] {
    return [];
  }
}

const synchronousVocabulary = vocabulary({
  concepts: { Saving: SynchronousActionConcept },
  computations: {},
});
const synchronousOptions: AssemblyOptions<{ Saving: typeof SynchronousActionConcept }, {}> = {
  vocabulary: synchronousVocabulary,
  composition: {},
  initialize: { Saving: ["saved:"] },
  logging: Logging.TRACE,
};
const instrumentedSurface = assemble(synchronousOptions);

const saved: Promise<{ value: string } | ActionRefusal> = instrumentedSurface.concepts.Saving.save({
  value: "ok",
});
void saved;
const queried: { value: string }[] = instrumentedSurface.concepts.Saving._saved({});
void queried;

const gatewayOptions: GatewayOptions = {
  application: instrumentedSurface,
  logging: Logging.VERBOSE,
};
void gatewayOptions;

// @ts-expect-error Direct action calls may resolve to an ActionRefusal.
const successOnly: Promise<{ value: string }> = instrumentedSurface.concepts.Saving.save({
  value: "unchecked",
});
void successOnly;

// @ts-expect-error Instrumented actions settle asynchronously even when the plain class action is sync.
const notSaved: { value: string } = instrumentedSurface.concepts.Saving.save({ value: "not yet" });
void notSaved;
