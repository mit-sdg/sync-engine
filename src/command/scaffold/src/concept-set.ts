import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { noting } from "./concepts/noting/registry.ts";

export const {{app}}Concepts = conceptSet({ Noting: noting });
export const { concepts, vocabulary } = {{app}}Concepts;
