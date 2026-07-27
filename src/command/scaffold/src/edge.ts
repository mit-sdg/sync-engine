import { createGateway } from "@mit-sdg/sync-engine/boundary";
import type { {{App}}Wire } from "../generated/wire.ts";
import { assemble{{App}} } from "./assembly.ts";

export function build{{App}}() {
  const application = assemble{{App}}();
  const gateway = createGateway<{{App}}Wire>({ application });
  return { application, gateway };
}
