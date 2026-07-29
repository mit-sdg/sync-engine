import { createHttpClient, type Client, type HttpClientOptions } from "@mit-sdg/sync-engine/client";
import type { ProductionHttpWireHttp } from "../generated/wire.ts";

export type ProductionHttpClient = Client<ProductionHttpWireHttp>;

export function createProductionHttpClient(options: HttpClientOptions = {}): ProductionHttpClient {
  return createHttpClient<ProductionHttpWireHttp>(options);
}
