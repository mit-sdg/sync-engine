/** Declare the public requests a composition can receive and answer. */
export { endpoint, receive, respond } from "@engine/boundary/assemble";
export type { EndpointDef } from "@engine/boundary/assemble";
export type { InputContractDecl } from "@engine/boundary/endpoints";
export { FrameworkErrorCode } from "@engine/boundary/errors";
export type { EmittedFrameworkErrorCode, InvocationResult } from "@engine/boundary/errors";
export type { Invoker, InvokeOptions } from "@engine/boundary/invoke";
export { createGateway } from "@engine/boundary/public-gateway";
export type {
  Gateway,
  GatewayClientError,
  GatewayOptions,
  GatewayTarget,
} from "@engine/boundary/public-gateway";
export type { ApplicationInterface } from "@engine/boundary/application-interface";
export { createHttpHandler } from "@engine/boundary/http";
export { httpFloor } from "@engine/boundary/http-floor";
export type { HttpCredentialBinding, HttpFloor } from "@engine/boundary/http-floor";
export {
  command,
  createCliApp,
  fail,
  ok,
  parseArgs,
  parseFail,
  parseOk,
} from "@engine/boundary/cli-app";
export type {
  CliApp,
  CliAppOptions,
  CliCommand,
  CliResult,
  CommandInput,
  EndpointCliCommand,
  ParsedArgs,
  ParseResult,
} from "@engine/boundary/cli-app";
