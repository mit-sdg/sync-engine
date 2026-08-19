/** Declare the public requests a composition can receive and answer. */
export { endpoint, endpointPrefix, receive, respond } from "@engine/boundary/assembly/assemble";
export type {
  EndpointDef,
  EndpointOptions,
  EndpointRouteContext,
} from "@engine/boundary/assembly/assemble";
export { defineInterface } from "@engine/boundary/protocol/interface-definition";
export type { InterfaceDefinition } from "@engine/boundary/protocol/interface-definition";
export { bindInterface } from "@engine/boundary/gateway/interface-binding";
export type { InterfaceBinding } from "@engine/boundary/gateway/interface-binding";
export {
  bindInterfaceExports,
  evaluateEndpoint,
} from "@engine/boundary/assembly/interface-exports";
export type {
  BoundInterfaceEndpoint,
  BoundInterfaceExports,
  EvaluatedEndpoint,
  InterfaceExportBindings,
} from "@engine/boundary/assembly/interface-exports";
export type { InputContractDecl } from "@engine/boundary/protocol/endpoints";
export type {
  EndpointValidator,
  EndpointValidators,
  ValidationResult,
} from "@engine/boundary/protocol/validation";
export { FrameworkErrorCode } from "@engine/boundary/protocol/types";
export type { InvocationResult } from "@engine/boundary/protocol/types";
export type { Invoker, InvokeOptions } from "@engine/boundary/invocation/invoke";
export type { ExecutionLimits } from "@engine/boundary/invocation/lifecycle";
export type {
  OperationalEvent,
  OperationalObserver,
  OperationalResultClass,
} from "@engine/reactions/runtime/operational";
export { createGateway } from "@engine/boundary/gateway/gateway";
export type { Gateway, GatewayOptions, GatewayTarget } from "@engine/boundary/gateway/gateway";
export { assertPortableRoutePath } from "@engine/boundary/protocol/route-path";
export { bindTransport } from "@engine/boundary/gateway/transport-binding";
export type {
  TransportBinding,
  WireProjectionFacts,
} from "@engine/boundary/gateway/transport-binding";
export { serializeJsonValue } from "@engine/boundary/protocol/envelope";
export type { ApplicationInterface } from "@engine/boundary/protocol/types";
