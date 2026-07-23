/** Consume a generated wire contract, locally or over HTTP. */
export { createClient } from "../engine/boundary/client.ts";
export { createHttpClient, createHttpTransport } from "../engine/boundary/http-client.ts";
export { createLocalClient } from "../engine/boundary/local-client.ts";
export type {
  Client,
  ClientError,
  ClientOptions,
  ClientRequest,
  ClientTransport,
  ContractShape,
  DomainErrorValue,
} from "../engine/boundary/client.ts";
export type { HeadersOption, HttpClientOptions } from "../engine/boundary/http-client.ts";
