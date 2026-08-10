import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { gathering } from "../concept/gathering/registry.ts";
import { selecting } from "../concept/selecting/registry.ts";

export const applicationConcepts = conceptSet({ Gathering: gathering, Selecting: selecting });
export const { concepts, vocabulary } = applicationConcepts;
