import { createHttpClient, type Client, type HttpClientOptions } from "@mit-sdg/sync-engine/client";
import type { OperationsRoomWire } from "../generated/wire.ts";

export type OperationsRoomClient = Client<OperationsRoomWire>;

export function createOperationsRoomClient(options: HttpClientOptions = {}): OperationsRoomClient {
  return createHttpClient<OperationsRoomWire>(options);
}

export const operations = createOperationsRoomClient({ baseUrl: "/api" });

export async function loadRoomDashboard(client: OperationsRoomClient, room: string) {
  const result = await client.rooms.get({ room });
  if ("error" in result) return { message: `Could not load the room: ${result.error}` };
  return result.dashboard;
}
