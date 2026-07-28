import { createClient, createHttpClient, createLocalClient } from "@mit-sdg/sync-engine/client";
import type { ClientError } from "@mit-sdg/sync-engine/client";
import { assemble, Logging } from "@mit-sdg/sync-engine/assembly";
import type { ActionRefusal, AssemblyOptions } from "@mit-sdg/sync-engine/assembly";
import { productionHttpProfile } from "@mit-sdg/sync-engine/boundary";
import type {
  GatewayOptions,
  InvocationResult,
  Invoker,
  ProductionHttpProfile,
} from "@mit-sdg/sync-engine/boundary";
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

const directVocabulary = vocabulary({ concepts: { Direct: DirectConcept }, computations: {} });
const directOptions: AssemblyOptions<{ Direct: typeof DirectConcept }, {}> = {
  vocabulary: directVocabulary,
  composition: {},
  initialize: { Direct: ["direct:"] },
  logging: Logging.TRACE,
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
void [directAction, directQuery, gatewayOptions, httpProfile];

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
const http = createHttpClient<ConsumerApi>({ baseUrl: "https://example.test/api" });
const custom = createClient<ConsumerApi>({ transport: async () => ({ section: "S1" }) });

const localResult: Promise<CreateResult> = local.roster["sections/create"]({
  course: "C1",
  title: "Morning",
});
const httpResult: Promise<CreateResult> = http.roster.sections.create({
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

void [localResult, httpResult, customResult, invocation];

// @ts-expect-error The generated input contract requires a title.
void http.roster.sections.create({ course: "C1" });
