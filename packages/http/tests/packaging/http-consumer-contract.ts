import { createClient, type ClientError } from "@mit-sdg/sync-engine/client";
import {
  createHttpClient,
  createHttpTransport,
  type HttpClientError,
} from "@mit-sdg/sync-engine-http/client";
import { httpPolicy, type HttpPolicy } from "@mit-sdg/sync-engine-http/policy";

const policy: HttpPolicy = httpPolicy({
  publicOrigin: "https://example.test",
  basePath: "/api",
});
void policy;

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

const http = createHttpClient<ConsumerApi>({ baseUrl: "https://example.test/api" });
const directHttp = createClient<ConsumerApi, HttpClientError>({
  transport: createHttpTransport({ baseUrl: "https://example.test/api" }),
});
const httpResult: Promise<CreateResult> = http.roster.sections.create({
  course: "C1",
  title: "Morning",
});
const directHttpResult: Promise<CreateResult> = directHttp.roster.sections.create({
  course: "C1",
  title: "Morning",
});
void [httpResult, directHttpResult];

// @ts-expect-error The generated input contract requires a title.
void http.roster.sections.create({ course: "C1" });
