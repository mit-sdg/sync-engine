/** Consume a generated wire contract, locally or through a transport. */
export { createClient } from "@engine/boundary/client/client";
export { createLocalClient } from "@engine/boundary/client/local-client";
export type {
  Client,
  ClientCallOptions,
  ClientError,
  ClientOptions,
  ClientRequest,
  ClientResponseValidator,
  ClientTransport,
  ContractShape,
  DomainErrorValue,
} from "@engine/boundary/client/client";
