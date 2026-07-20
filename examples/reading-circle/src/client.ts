import { createHttpClient, type Client, type HttpClientOptions } from "@mit-sdg/sync-engine/client";
import type { ReadingCircleWire } from "../generated/wire.ts";

export type ReadingCircleClient = Client<ReadingCircleWire>;

export function createReadingCircleClient(options: HttpClientOptions = {}): ReadingCircleClient {
  return createHttpClient<ReadingCircleWire>(options);
}

export async function loadCirclePage(circles: ReadingCircleClient, circle: string) {
  const result = await circles.circles.page({ circle });
  if ("error" in result) return { message: `Could not load the circle: ${result.error}` };
  return result.page;
}
