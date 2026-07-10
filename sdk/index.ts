export { createClient } from "./client.ts";
export type {
  Client,
  ClientError,
  ClientOptions,
  ClientRequest,
  ClientTransport,
  ContractShape,
} from "./client.ts";

export { createHttpTransport, createHttpClient } from "./http-client.ts";
export type { HeadersOption, HttpClientOptions } from "./http-client.ts";

export { createHttpHandler } from "./http.ts";

export { createEndpointDsl, syncMap, unchecked } from "./endpoints.ts";
export type {
  ContractOf,
  EndpointContract,
  EndpointHelpers,
  Prettify,
  RequestBoundaryActions,
  TypedSchema,
} from "./endpoints.ts";

export {
  FrameworkErrorCode,
  type InvocationResult,
  domainError,
  frameworkError,
  success,
} from "./errors.ts";

export { createInvoker, createLocalClient, RequestBoundaryConcept } from "./invoke.ts";
export type { Invoker } from "./invoke.ts";

export { command, createCliApp, fail, ok, parseArgs, parseFail, parseOk } from "./cli-app.ts";
export type {
  CliApp,
  CliAppOptions,
  CliCommand,
  CliResult,
  CommandInput,
  EndpointCliCommand,
  ParsedArgs,
  ParseResult,
} from "./cli-app.ts";
