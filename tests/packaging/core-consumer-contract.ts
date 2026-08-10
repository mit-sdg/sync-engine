import { createClient, createLocalClient } from "@mit-sdg/sync-engine/client";
import type { ClientError, ClientTransport } from "@mit-sdg/sync-engine/client";
import { assemble, conceptSet, Logging, registerConcept } from "@mit-sdg/sync-engine/assembly";
import type {
  ActionRefusal,
  AssemblyOptions,
  LogEntry,
  LogSink,
} from "@mit-sdg/sync-engine/assembly";
import type { GatewayOptions, InvocationResult, Invoker } from "@mit-sdg/sync-engine/boundary";
import { reaction, vocabulary, when } from "@mit-sdg/sync-engine/language";
import type {
  ApplicationManifestV5,
  ComputationInventoryIR,
  ConceptImplementationProvenanceIR,
} from "@mit-sdg/sync-engine/tooling";

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

class QueriedConcept {
  _answer({ key }: { key: string }): { value: string }[] {
    return key === "present" ? [{ value: key }] : [];
  }
}

vocabulary({
  concepts: { QueriedConcept: { class: QueriedConcept, queries: { _answer: "optional" } } },
  computations: {},
});

class DirectConcept {
  constructor(readonly prefix = "") {}

  act({ value }: { value: string }) {
    return { value: `${this.prefix}${value}` };
  }

  _read(_: Record<string, never>): { value: string }[] {
    return [];
  }
}

const directSet = conceptSet(
  { Direct: registerConcept({ class: DirectConcept, spec: "# Concept" }) },
  { normalize: ({ value }: { value: string }) => value.trim() },
);
directSet.computations.normalize({ value: "packed" });
// @ts-expect-error Packed declarations preserve computation input signatures.
directSet.computations.normalize({ value: false });

const directVocabulary = vocabulary({ concepts: { Direct: DirectConcept }, computations: {} });
const Direct = directVocabulary.concepts.Direct;
reaction(({ value }) =>
  when(Direct.act({ value }).responds({ value })).afterFlowSettles().then(Direct.act({ value })),
);
reaction(({ value }) =>
  when(Direct.act({ value }).responds({ value }))
    .then(Direct.act({ value }))
    .afterFlowSettles()
    // @ts-expect-error A chained deferred stage accepts condition lines, not a frame function.
    .where((frames: object) => frames)
    .then(Direct.act({ value })),
);
const packedTiming = Direct.act({ value: "packed" });
// @ts-expect-error Deferred timing is authored through afterFlowSettles().
packedTiming.deferred = true;
const occurrenceEntries: LogEntry[] = [];
const logSink: LogSink = {
  append(entry) {
    occurrenceEntries.push(entry);
  },
};
const accidentallyAsyncLogSink: LogSink = {
  // @ts-expect-error A log sink must finish before the entry is folded.
  async append(_entry) {},
};
class AccidentallyAsyncLogSink implements LogSink {
  // @ts-expect-error Class implementations must also finish synchronously.
  async append(_entry: LogEntry) {}
}
declare const occurrenceEntry: LogEntry;
if (occurrenceEntry.kind === "invocation") {
  const actionName: string = occurrenceEntry.record.action.name;
  const conceptName: string = occurrenceEntry.record.concept.name;
  void [actionName, conceptName];
  // @ts-expect-error Sink entries are immutable snapshots.
  occurrenceEntry.record.input.changed = true;
}
if (occurrenceEntry.kind === "firing") {
  // @ts-expect-error Nested sink-entry arrays are immutable snapshots.
  occurrenceEntry.firing.consumed.push("another-id");
}
void [accidentallyAsyncLogSink, AccidentallyAsyncLogSink];
const directOptions: AssemblyOptions<{ Direct: typeof DirectConcept }, {}> = {
  vocabulary: directVocabulary,
  composition: {},
  initialize: { Direct: ["direct:"] },
  logging: Logging.TRACE,
  logSink,
  retention: "keepAll",
};
const directAssembly = assemble(directOptions);
const directAction: Promise<{ value: string } | ActionRefusal> = directAssembly.concepts.Direct.act(
  { value: "value" },
);
const directQuery: Promise<{ value: string }[]> = directAssembly.concepts.Direct._read({});
const gatewayOptions: GatewayOptions = {
  application: directAssembly,
};
void [directAction, directQuery, gatewayOptions, occurrenceEntries];

// @ts-expect-error A direct action caller must account for refusal mappings.
const directSuccessOnly: Promise<{ value: string }> = directAssembly.concepts.Direct.act({
  value: "unchecked",
});
void directSuccessOnly;

type ConsumerApi = {
  "/roster/sections/create": {
    input: { course: string; title: string };
    output: { section: string };
    error: { error: "COURSE_NOT_FOUND" | "TITLE_TAKEN" };
  };
};

type CreateResult =
  | { section: string }
  | { error: "COURSE_NOT_FOUND" | "TITLE_TAKEN" }
  | ClientError;

declare const invoker: Invoker<ConsumerApi>;

const local = createLocalClient<ConsumerApi>({ invoker });
const userWrittenTransport: ClientTransport = async ({ path, input }) => {
  if (path !== "/roster/sections/create" || input === null) return { error: "TRANSPORT_ERROR" };
  return { section: "S1" };
};
const custom = createClient<ConsumerApi>({ transport: userWrittenTransport });

const localResult: Promise<CreateResult> = local.roster["sections/create"]({
  course: "C1",
  title: "Morning",
});
const customResult: Promise<CreateResult> = custom["/roster/sections/create"]({
  course: "C1",
  title: "Morning",
});
const invocation: Promise<
  InvocationResult<{ section: string }, "COURSE_NOT_FOUND" | "TITLE_TAKEN">
> = invoker.invoke("/roster/sections/create", { course: "C1", title: "Morning" });

void [localResult, customResult, invocation];
