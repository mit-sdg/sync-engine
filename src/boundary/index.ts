/** Declare the public requests a composition can receive and answer. */
export { endpoint, receive, respond } from "@engine/boundary/assembly/assemble";
export type { EndpointDef, EndpointOptions } from "@engine/boundary/assembly/assemble";
export type { InputContractDecl } from "@engine/boundary/protocol/endpoints";
export type {
  EndpointValidator,
  EndpointValidators,
  ValidationResult,
} from "@engine/boundary/protocol/validation";
export { FrameworkErrorCode } from "@engine/boundary/protocol/errors";
export type { EmittedFrameworkErrorCode, InvocationResult } from "@engine/boundary/protocol/errors";
export type { Invoker, InvokeOptions } from "@engine/boundary/invocation/invoke";
export type { ExecutionLimits } from "@engine/boundary/invocation/lifecycle";
export { createGateway } from "@engine/boundary/gateway/public-gateway";
export type {
  Gateway,
  GatewayClientError,
  GatewayOptions,
  GatewayTarget,
} from "@engine/boundary/gateway/public-gateway";
export type { ApplicationInterface } from "@engine/boundary/protocol/application-interface";
export { createHttpHandler } from "@engine/boundary/http/http";
export { httpFloor } from "@engine/boundary/http/http-floor";
export type { HttpCredentialBinding, HttpFloor } from "@engine/boundary/http/http-floor";
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
