import { conceptSet, registerConcept } from "@sync-engine/assembly";

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
