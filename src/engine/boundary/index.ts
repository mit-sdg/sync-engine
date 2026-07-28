export { createClient } from "./client/client.ts";
export type {
  Client,
  ClientCallOptions,
  ClientError,
  ClientOptions,
  ClientRequest,
  ClientTransport,
  ContractShape,
  DomainErrorValue,
} from "./client/client.ts";

export { createHttpTransport, createHttpClient } from "./client/http-client.ts";
export type { HeadersOption, HttpClientOptions } from "./client/http-client.ts";

export { createHttpHandler } from "./http/http.ts";
export type { HttpCorrelationOptions } from "./http/http.ts";

export { renderInputContracts } from "./protocol/endpoints.ts";
export type { InputContractDecl, Prettify, RequestBoundaryActions } from "./protocol/endpoints.ts";
export type {
  EndpointValidator,
  EndpointValidators,
  ValidationResult,
} from "./protocol/validation.ts";

export {
  FrameworkErrorCode,
  type EmittedFrameworkErrorCode,
  type InvocationResult,
  domainError,
  frameworkError,
  success,
} from "./protocol/errors.ts";

export { createInvoker, Requesting } from "./invocation/invoke.ts";
export { createLocalClient } from "./client/local-client.ts";
export type { Invoker, InvokeOptions } from "./invocation/invoke.ts";
export type { ExecutionLimits } from "./invocation/lifecycle.ts";
export type {
  OperationalEvent,
  OperationalObserver,
  OperationalResultClass,
} from "@engine/reactions/runtime/operational";

export { FAULT_REPLY, FAULT_REACTION, refusalFunnel } from "./invocation/funnel.ts";

export { assemble, endpoint, fail, isEndpointDef, receive, respond } from "./assembly/assemble.ts";
export type {
  AssembledApp,
  AssembleOptions,
  EndpointDef,
  EndpointOptions,
} from "./assembly/assemble.ts";
export type { ApplicationInterface } from "./protocol/application-interface.ts";

export { createGateway } from "./gateway/gateway.ts";
export type { Gateway, GatewayClientError, GatewayOptions } from "./gateway/gateway.ts";

export { deriveInputContracts, renderWireTypes, wireContracts } from "./wire/wire.ts";
export type {
  WireContractsIR,
  WireEndpoint,
  WireOptions,
  WireRenderOptions,
  WireType,
} from "./wire/wire.ts";

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
