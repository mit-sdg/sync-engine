import type { Client } from "@mit-sdg/sync-engine/client";
import type { ProductionHttpWireHttp } from "../generated/wire.ts";

declare const client: Client<ProductionHttpWireHttp>;

void client.sessions.current({});

// @ts-expect-error The floor consumes the session credential from a cookie.
void client.sessions.current({ session: "credential" });
