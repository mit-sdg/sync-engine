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
import {
  createHttpClient,
  createHttpTransport,
  type HttpClientError,
} from "@mit-sdg/sync-engine-http/client";
import {
  productionHttpProfile,
  type ProductionHttpProfile,
} from "@mit-sdg/sync-engine-http/server";
import { vocabulary } from "@mit-sdg/sync-engine/language";
import type { ApplicationManifestV3 } from "@mit-sdg/sync-engine/tooling";

declare const manifestV3: ApplicationManifestV3;
const manifestVersion: 3 = manifestV3.version;
void manifestVersion;

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
const httpProfile: ProductionHttpProfile = productionHttpProfile({
  origin: "https://example.test",
  basePath: "/api",
});
void [directAction, directQuery, gatewayOptions, httpProfile, occurrenceEntries];

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
  | ClientError
  | HttpClientError;

declare const invoker: Invoker<ConsumerApi>;

const local = createLocalClient<ConsumerApi>({ invoker });
const http = createHttpClient<ConsumerApi>({ baseUrl: "https://example.test/api" });
const directHttp = createClient<ConsumerApi, HttpClientError>({
  transport: createHttpTransport({ baseUrl: "https://example.test/api" }),
});
const userWrittenTransport: ClientTransport = async ({ path, input }) => {
  if (path !== "/roster/sections/create" || input === null) return { error: "TRANSPORT_ERROR" };
  return { section: "S1" };
};
const custom = createClient<ConsumerApi>({ transport: userWrittenTransport });

const localResult: Promise<CreateResult> = local.roster["sections/create"]({
  course: "C1",
  title: "Morning",
});
const httpResult: Promise<CreateResult> = http.roster.sections.create({
  course: "C1",
  title: "Morning",
});
const directHttpResult: Promise<CreateResult> = directHttp.roster.sections.create({
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

void [localResult, httpResult, directHttpResult, customResult, invocation];

// @ts-expect-error The generated input contract requires a title.
void http.roster.sections.create({ course: "C1" });
