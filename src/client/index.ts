/** Consume a generated wire contract, locally or over HTTP. */
export { createClient } from "@engine/boundary/client/client";
export { createHttpClient, createHttpTransport } from "@engine/boundary/client/http-client";
export { createLocalClient } from "@engine/boundary/client/local-client";
export type {
  Client,
  ClientCallOptions,
  ClientError,
  ClientOptions,
  ClientRequest,
  ClientTransport,
  ContractShape,
  DomainErrorValue,
} from "@engine/boundary/client/client";
export type { HeadersOption, HttpClientOptions } from "@engine/boundary/client/http-client";
