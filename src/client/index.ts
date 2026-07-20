/** Consume a generated wire contract, locally or over HTTP. */
export { createClient } from "../internal/boundary/client.ts";
export { createHttpClient, createHttpTransport } from "../internal/boundary/http-client.ts";
export { createLocalClient } from "../internal/boundary/local-client.ts";
export type {
  Client,
  ClientError,
  ClientOptions,
  ClientRequest,
  ClientTransport,
  ContractShape,
  DomainErrorValue,
} from "../internal/boundary/client.ts";
export type { HeadersOption, HttpClientOptions } from "../internal/boundary/http-client.ts";
