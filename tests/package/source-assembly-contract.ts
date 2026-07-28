import { assemble, conceptSet, Logging, registerConcept } from "@sync-engine/assembly";
import type { ActionRefusal, AssemblyOptions, ConceptImplementation } from "@sync-engine/assembly";
import type { GatewayOptions } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/language";
import type { ApplicationManifestV3 } from "@sync-engine/tooling";

declare const manifestV3: ApplicationManifestV3;
const manifestVersion: 3 = manifestV3.version;
void manifestVersion;

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
const queried: Promise<{ value: string }[]> = instrumentedSurface.concepts.Saving._saved({});
void queried;

// @ts-expect-error Assembled queries are lifecycle-tracked asynchronous roots.
const synchronousQuery: { value: string }[] = instrumentedSurface.concepts.Saving._saved({});
void synchronousQuery;

const gatewayOptions: GatewayOptions = {
  application: instrumentedSurface,
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

class ReplacementProtocol {
  readonly state = new Map<string, string>();

  save({ value }: { value: string }) {
    this.state.set(value, value);
    return { value };
  }

  _saved(_: Record<string, never>): { value: string }[] {
    return [];
  }
}

class InheritedReplacement extends ReplacementProtocol {
  readonly connection = "primary";
}

const ownMethodReplacement: ConceptImplementation<typeof ReplacementProtocol> = {
  save({ value }: { value: string }) {
    return Promise.resolve({ value });
  },
  _saved(_: Record<string, never>) {
    return [{ value: "replacement" }];
  },
};

const replacementSet = conceptSet({
  Replacing: registerConcept({
    class: ReplacementProtocol,
    spec,
    floors: {
      own: () => ownMethodReplacement,
      inherited: () => new InheritedReplacement(),
      // @ts-expect-error A floor factory must return the registered callable protocol.
      malformed: () => ({ state: new Map<string, string>() }),
    },
  }),
});

replacementSet.implementations("own", undefined);
replacementSet.implementations("inherited", undefined);
assemble({
  vocabulary: replacementSet.vocabulary,
  composition: {},
  instances: { Replacing: ownMethodReplacement },
});

assemble({
  vocabulary: replacementSet.vocabulary,
  composition: {},
  instances: {
    // @ts-expect-error Public assembly replacements must implement the callable protocol.
    Replacing: { state: new Map<string, string>() },
  },
});
