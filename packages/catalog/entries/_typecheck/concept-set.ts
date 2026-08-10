import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { alerting } from "../concept/alerting/registry.ts";
import { gathering } from "../concept/gathering/registry.ts";
import { reserving } from "../concept/reserving/registry.ts";
import { selecting } from "../concept/selecting/registry.ts";
import { timing } from "../concept/timing/registry.ts";
import { upvoting } from "../concept/upvoting/registry.ts";

export const applicationConcepts = conceptSet({
  Alerting: alerting,
  Gathering: gathering,
  Reserving: reserving,
  Selecting: selecting,
  Timing: timing,
  Upvoting: upvoting,
});
export const { concepts, vocabulary } = applicationConcepts;
