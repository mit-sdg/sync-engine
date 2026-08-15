import { expect, test } from "vite-plus/test";
import { filingConformance } from "./filing.conformance.ts";
import { FilingConcept } from "./filing.ts";
import { filing } from "./registry.ts";

filingConformance("node", () => new FilingConcept());

test("Filing registry exposes its complete refusal and query contract", () => {
  expect(Object.keys(filing.refusals ?? {}).sort()).toEqual([
    "FILE_NOT_FOUND",
    "INVALID_ENCODING",
    "INVALID_PATH",
    "INVALID_SOURCE",
    "PATH_LEAVES_ROOT",
    "ROOT_NOT_FOUND",
  ]);
  expect(filing.specification.queries.map(({ name, promise }) => [name, promise])).toEqual([
    ["_root", "optional"],
    ["_named", "optional"],
    ["_file", "optional"],
    ["_text", "optional"],
    ["_at", "optional"],
    ["_files", "many"],
    ["_under", "many"],
    ["_resolve", "optional"],
    ["_resolution", "one"],
  ]);
});
