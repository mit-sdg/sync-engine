import { createClient, createHttpClient, createLocalClient } from "@mit-sdg/sync-engine/client";
import type { ClientError } from "@mit-sdg/sync-engine/client";
import type { InvocationResult, Invoker } from "@mit-sdg/sync-engine/boundary";
import { vocabulary } from "@mit-sdg/sync-engine/language";

class QueriedConcept {
  static readonly queries = { _answer: "optional" } as const;

  _answer({ key }: { key: string }): { value: string }[] {
    return key === "present" ? [{ value: key }] : [];
  }
}

vocabulary({ concepts: { QueriedConcept }, computations: {} });

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
