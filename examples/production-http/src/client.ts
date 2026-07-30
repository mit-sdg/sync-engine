import type { Client } from "@mit-sdg/sync-engine/client";
import {
  createHttpClient,
  type HttpClientError,
  type HttpClientOptions,
} from "@mit-sdg/sync-engine-http/client";
import type { ProductionHttpWireHttp } from "../generated/wire.ts";

export type ProductionHttpClient = Client<ProductionHttpWireHttp, HttpClientError>;

export function createProductionHttpClient(options: HttpClientOptions = {}): ProductionHttpClient {
  return createHttpClient<ProductionHttpWireHttp>(options);
}
