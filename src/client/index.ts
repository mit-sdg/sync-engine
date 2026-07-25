/** Consume a generated wire contract, locally or over HTTP. */
export { createClient } from "@engine/boundary/client";
export { createHttpClient, createHttpTransport } from "@engine/boundary/http-client";
export { createLocalClient } from "@engine/boundary/local-client";
export type {
  Client,
  ClientError,
  ClientOptions,
  ClientRequest,
  ClientTransport,
  ContractShape,
  DomainErrorValue,
} from "@engine/boundary/client";
export type { HeadersOption, HttpClientOptions } from "@engine/boundary/http-client";
