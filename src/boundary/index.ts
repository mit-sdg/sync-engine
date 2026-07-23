/** Declare the public requests a composition can receive and answer. */
export { endpoint, receive, respond } from "../engine/boundary/assemble.ts";
export type { EndpointDef } from "../engine/boundary/assemble.ts";
export type { InputContractDecl } from "../engine/boundary/endpoints.ts";
export { FrameworkErrorCode } from "../engine/boundary/errors.ts";
export type { EmittedFrameworkErrorCode, InvocationResult } from "../engine/boundary/errors.ts";
export type { Invoker, InvokeOptions } from "../engine/boundary/invoke.ts";
export { createGateway } from "../engine/boundary/public-gateway.ts";
export type {
  Gateway,
  GatewayClientError,
  GatewayOptions,
  GatewayTarget,
} from "../engine/boundary/public-gateway.ts";
export type { ApplicationInterface } from "../engine/boundary/application-interface.ts";
export { createHttpHandler } from "../engine/boundary/http.ts";
export { httpFloor } from "../engine/boundary/http-floor.ts";
export type { HttpCredentialBinding, HttpFloor } from "../engine/boundary/http-floor.ts";
export {
  command,
  createCliApp,
  fail,
  ok,
  parseArgs,
  parseFail,
  parseOk,
} from "../engine/boundary/cli-app.ts";
export type {
  CliApp,
  CliAppOptions,
  CliCommand,
  CliResult,
  CommandInput,
  EndpointCliCommand,
  ParsedArgs,
  ParseResult,
} from "../engine/boundary/cli-app.ts";
