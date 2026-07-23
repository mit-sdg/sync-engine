import { assemble, conceptSet, registerConcept } from "@sync-engine/assembly";
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
  save({ value }: { value: string }) {
    return { value };
  }
}

const instrumentedSurface = assemble({
  vocabulary: vocabulary({ concepts: { Saving: SynchronousActionConcept }, computations: {} }),
  composition: {},
});

const saved: Promise<{ value: string }> = instrumentedSurface.concepts.Saving.save({ value: "ok" });
void saved;

// @ts-expect-error Instrumented actions settle asynchronously even when the plain class action is sync.
const notSaved: { value: string } = instrumentedSurface.concepts.Saving.save({ value: "not yet" });
void notSaved;
