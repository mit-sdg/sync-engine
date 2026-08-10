import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { gathering } from "../concept/gathering/registry.ts";
import { selecting } from "../concept/selecting/registry.ts";
import { timing } from "../concept/timing/registry.ts";
import { upvoting } from "../concept/upvoting/registry.ts";

export const applicationConcepts = conceptSet({
  Gathering: gathering,
  Selecting: selecting,
  Timing: timing,
  Upvoting: upvoting,
});
export const { concepts, vocabulary } = applicationConcepts;
