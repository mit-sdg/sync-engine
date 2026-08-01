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
import { each, form, former } from "@sync-engine/language";
import type { ApplicationManifestV3 } from "@sync-engine/tooling";

declare const manifestV3: ApplicationManifestV3;
const manifestVersion: 3 = manifestV3.version;
void manifestVersion;

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

interface TextComputationInput {
  value: string;
}

class ComputationClassInput {
  constructor(readonly value: string) {}

  read() {
    return this.value;
  }
}

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

const computed = conceptSet(
  {
    First: registerConcept({ class: FirstConcept, spec }),
  },
  {
    normalize: ({ value }: TextComputationInput) => value.trim(),
    size: ({ value }: TextComputationInput) => value.length,
    constant: (_: Record<string, never>) => 1,
  },
);
computed.computations.normalize({ value: " ready " });
computed.vocabulary.computations.size({ value: "ready" });
// @ts-expect-error Computation inputs retain their declared value types.
computed.computations.normalize({ value: 1 });
// @ts-expect-error Computation calls require every declared input.
computed.computations.normalize({});
// @ts-expect-error Computation calls reject undeclared inputs.
computed.computations.normalize({ value: "ready", extra: true });
computed.computations.constant({});
// @ts-expect-error A zero-input computation does not accept arbitrary keys.
computed.computations.constant({ extra: true });
// @ts-expect-error The concept set exposes only its declared computations.
void computed.computations.missing;

const indexedComputations = vocabulary({
  concepts: {},
  computations: {
    concatenate: (parts: Record<string, string>) => Object.values(parts).join(""),
    required: (parts: { [key: string]: string; required: string }) => parts.required,
  },
});
indexedComputations.computations.concatenate({ first: "a", second: "b" });
// @ts-expect-error String-indexed computation inputs retain their value type.
indexedComputations.computations.concatenate({ first: "a", second: 2 });
indexedComputations.computations.required({ required: "present" });
// @ts-expect-error Named required properties survive a string index signature.
indexedComputations.computations.required({});

// @ts-expect-error Computations receive an object mapping, not a primitive parameter.
vocabulary({ concepts: {}, computations: { malformed: (value: number) => value } });
// @ts-expect-error Computation inputs are mappings, not arrays.
vocabulary({ concepts: {}, computations: { malformed: (value: string[]) => value.length } });
vocabulary({
  concepts: {},
  computations: {
    // @ts-expect-error Every member of a computation input union must be object-shaped.
    malformed: (value: { text: string } | number) => String(value),
  },
});
vocabulary({
  concepts: {},
  computations: {
    // @ts-expect-error Computations receive plain mappings, not method-bearing class instances.
    malformed: (value: ComputationClassInput) => value.read(),
  },
});
// @ts-expect-error conceptSet enforces the same object-shaped computation input contract.
conceptSet({}, { malformed: (value: number) => value });

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

const savedValues = former("the saved values", (_inputs, bindings) => {
  const value = bindings("value");
  return form({
    values: each(synchronousVocabulary.concepts.Saving._saved({}).is({ value })).form({ value }),
    first: each(synchronousVocabulary.concepts.Saving._saved({}).is({ value })).first(value),
  });
});
const formedValues: Promise<{
  values: { value: string }[];
  first: string | null;
}> = instrumentedSurface.form(savedValues({}));
void formedValues;

const maybeSavedValue = former("the optional saved value", (_inputs, bindings) => {
  const value = bindings("value");
  return each(synchronousVocabulary.concepts.Saving._saved({}).is({ value })).first(value);
});
const formedMaybe: Promise<string | null> = instrumentedSurface.form(maybeSavedValue({}));
void formedMaybe;

// @ts-expect-error Direct former evaluation retains the inferred result type.
const malformedFormed: Promise<{ value: number }> = instrumentedSurface.form(savedValues({}));
void malformedFormed;

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
