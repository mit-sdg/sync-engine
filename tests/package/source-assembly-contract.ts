import { assemble, conceptSet, Logging, registerConcept } from "@sync-engine/assembly";
import type {
  ActionRefusal,
  AssemblyOptions,
  ConceptImplementation,
  LogEntry,
  LogSink,
} from "@sync-engine/assembly";
import type { GatewayOptions } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/language";
import type {
  ApplicationManifestV5,
  ComputationInventoryIR,
  ConceptImplementationProvenanceIR,
} from "@sync-engine/tooling";

declare const manifestV5: ApplicationManifestV5;
const manifestVersion: 5 = manifestV5.version;
void manifestVersion;
declare const computationInventory: ComputationInventoryIR;
const computationSource: "standard" | "vocabulary" = computationInventory.source;
void computationSource;
declare const implementationProvenance: ConceptImplementationProvenanceIR;
if (implementationProvenance.selected.via === "instances") {
  const selectedFloor: string | undefined = implementationProvenance.selected.floor;
  void selectedFloor;
}

class FirstConcept {}
class SecondConcept {}
class RequiredConcept {
  constructor(readonly name: string) {}
}
class AlsoRequiredConcept {
  constructor(readonly count: number) {}
}
class DefaultedConcept {
  constructor(readonly name = "default") {}
}
class RestConcept {
  readonly names: string[];
  constructor(...names: string[]) {
    this.names = names;
  }
}

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

const requiredSet = conceptSet({
  Required: registerConcept({
    class: RequiredConcept,
    spec,
    floors: { named: () => new RequiredConcept("named") },
  }),
});
// @ts-expect-error Required constructor arguments cannot be silently omitted.
requiredSet.implementations();
requiredSet.implementations("named", undefined);

const ergonomicSet = conceptSet({
  Defaulted: registerConcept({ class: DefaultedConcept, spec }),
  Rest: registerConcept({ class: RestConcept, spec }),
});
ergonomicSet.implementations();

const requiredVocabulary = vocabulary({
  concepts: {
    Required: RequiredConcept,
    AlsoRequired: AlsoRequiredConcept,
    Defaulted: DefaultedConcept,
    Rest: RestConcept,
  },
  computations: {},
});
// @ts-expect-error Every required constructor needs initialize or instances.
assemble({ vocabulary: requiredVocabulary, composition: {} });
assemble({
  vocabulary: requiredVocabulary,
  composition: {},
  initialize: { Required: ["initialized"], AlsoRequired: [1] },
});
assemble({
  vocabulary: requiredVocabulary,
  composition: {},
  instances: {
    Required: new RequiredConcept("provided"),
    AlsoRequired: new AlsoRequiredConcept(1),
  },
});
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
const occurrenceEntries: LogEntry[] = [];
const logSink: LogSink = {
  append(entry) {
    occurrenceEntries.push(entry);
  },
};
const synchronousOptions: AssemblyOptions<{ Saving: typeof SynchronousActionConcept }, {}> = {
  vocabulary: synchronousVocabulary,
  composition: {},
  initialize: { Saving: ["saved:"] },
  logging: Logging.TRACE,
  logSink,
  retention: "keepAll",
};
const instrumentedSurface = assemble(synchronousOptions);

const saved: Promise<{ value: string } | ActionRefusal> = instrumentedSurface.concepts.Saving.save({
  value: "ok",
});
void saved;
const queried: Promise<{ value: string }[]> = instrumentedSurface.concepts.Saving._saved({});
void queried;
void occurrenceEntries;

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
