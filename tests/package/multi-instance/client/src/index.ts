import { createHttpClient, type HttpClientOptions } from "@mit-sdg/sync-engine-http/client";
import type { MultiInstanceHttpWire } from "./generated/wire.ts";

export {
  Conflict,
  composition,
  multiInstanceConcepts,
  multiInstanceHttpPolicy,
  vocabulary,
} from "./contract.ts";
export type { MultiInstanceHttpWire, MultiInstanceWire } from "./generated/wire.ts";

export function createMultiInstanceClient(options: HttpClientOptions = {}) {
  return createHttpClient<MultiInstanceHttpWire>({
    baseUrl: "https://multi-instance.test/api",
    ...options,
  });
}
