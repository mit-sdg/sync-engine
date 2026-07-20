/** Declare the public requests a composition can receive and answer. */
export { endpoint, receive, respond } from "../internal/boundary/assemble.ts";
export type { EndpointDef } from "../internal/boundary/assemble.ts";
export type { InputContractDecl } from "../internal/boundary/endpoints.ts";
export { FrameworkErrorCode } from "../internal/boundary/errors.ts";
export type { EmittedFrameworkErrorCode, InvocationResult } from "../internal/boundary/errors.ts";
export type { Invoker, InvokeOptions } from "../internal/boundary/invoke.ts";
export { createGateway } from "../internal/boundary/public-gateway.ts";
export type {
  Gateway,
  GatewayClientError,
  GatewayOptions,
  GatewayTarget,
} from "../internal/boundary/public-gateway.ts";
export type { ApplicationInterface } from "../internal/boundary/application-interface.ts";
export { createHttpHandler } from "../internal/boundary/http.ts";
export { httpFloor } from "../internal/boundary/http-floor.ts";
export type { HttpCredentialBinding, HttpFloor } from "../internal/boundary/http-floor.ts";
export {
  command,
  createCliApp,
  fail,
  ok,
  parseArgs,
  parseFail,
  parseOk,
} from "../internal/boundary/cli-app.ts";
export type {
  CliApp,
  CliAppOptions,
  CliCommand,
  CliResult,
  CommandInput,
  EndpointCliCommand,
  ParsedArgs,
  ParseResult,
} from "../internal/boundary/cli-app.ts";
