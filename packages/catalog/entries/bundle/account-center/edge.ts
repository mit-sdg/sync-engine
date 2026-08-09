import { createGateway } from "@mit-sdg/sync-engine/boundary";
import type { AccountCenterWire } from "../generated/wire.ts";
import {
  accountCenterExecutionLimits,
  assembleAccountCenter,
  type AccountCenterOverrides,
} from "./assembly.ts";

export function buildAccountCenter(instances: AccountCenterOverrides = {}) {
  const application = assembleAccountCenter(instances);
  const gateway = createGateway<AccountCenterWire>({
    application,
    executionLimits: accountCenterExecutionLimits,
  });
  return { application, gateway };
}
