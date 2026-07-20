export { createClient } from "./client.ts";
export type {
  Client,
  ClientError,
  ClientOptions,
  ClientRequest,
  ClientTransport,
  ContractShape,
  DomainErrorValue,
} from "./client.ts";

export { createHttpTransport, createHttpClient } from "./http-client.ts";
export type { HeadersOption, HttpClientOptions } from "./http-client.ts";

export { createHttpHandler } from "./http.ts";

export { renderInputContracts } from "./endpoints.ts";
export type { InputContractDecl, Prettify, RequestBoundaryActions } from "./endpoints.ts";

export {
  FrameworkErrorCode,
  type EmittedFrameworkErrorCode,
  type InvocationResult,
  domainError,
  frameworkError,
  success,
} from "./errors.ts";

export { createInvoker, Requesting } from "./invoke.ts";
export { createLocalClient } from "./local-client.ts";
export type { Invoker, InvokeOptions } from "./invoke.ts";

export { FAULT_REPLY, FAULT_REACTION, refusalFunnel } from "./funnel.ts";

export { assemble, endpoint, fail, isEndpointDef, receive, respond } from "./assemble.ts";
export type { AssembledApp, AssembleOptions, EndpointDef } from "./assemble.ts";
export type { ApplicationInterface } from "./application-interface.ts";

export { createGateway } from "./gateway.ts";
export type { Gateway, GatewayClientError, GatewayOptions } from "./gateway.ts";

export { deriveInputContracts, renderWireTypes, wireContracts } from "./wire.ts";
export type {
  WireContractsIR,
  WireEndpoint,
  WireOptions,
  WireRenderOptions,
  WireType,
} from "./wire.ts";

// `fail` is the endpoint word (assemble.ts); the CLI results export as cli-prefixed.
export {
  command,
  createCliApp,
  fail as cliFail,
  ok as cliOk,
  parseArgs,
  parseFail,
  parseOk,
} from "./cli-app.ts";
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
