import type { Client } from "@mit-sdg/sync-engine/client";
import {
  createHttpClient,
  type HttpClientError,
  type HttpClientOptions,
} from "@mit-sdg/sync-engine-http/client";
import type { MessageBoardWireHttp } from "../generated/wire.ts";

export type MessageBoardClient = Client<MessageBoardWireHttp, HttpClientError>;

export function createMessageBoardClient(options: HttpClientOptions = {}): MessageBoardClient {
  return createHttpClient<MessageBoardWireHttp>(options);
}
