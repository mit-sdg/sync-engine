import { expect, test } from "vite-plus/test";
import { commandingConformance } from "./commanding.conformance.ts";
import { CommandingConcept } from "./commanding.ts";
import { commanding } from "./registry.ts";

commandingConformance("node", (arguments_) => {
  const written: Array<[string, string]> = [];
  const exits: number[] = [];
  const concept = new CommandingConcept({
    arguments: () => arguments_,
    write: (stream, text) => written.push([stream, text]),
    exit: (code) => exits.push(code),
  });
  return { concept, exits, written };
});

test("Commanding registry exposes invocation refusals and lifecycle queries", () => {
  expect(Object.keys(commanding.refusals ?? {}).sort()).toEqual([
    "EXIT_SELECTED",
    "INVALID_ARGUMENTS",
    "INVALID_EXIT_CODE",
    "INVALID_STREAM",
    "INVALID_TEXT",
    "INVOCATION_CAPTURED",
  ]);
  expect(commanding.specification.queries.map(({ name, promise }) => [name, promise])).toEqual([
    ["_invocation", "optional"],
    ["_outcome", "optional"],
  ]);
});
