import { describe, expect, test } from "vite-plus/test";
import {
  ExitSelected,
  InvalidArguments,
  InvalidExitCode,
  InvalidStream,
  InvalidText,
  InvocationCaptured,
  type CommandEnvironment,
  type CommandingConcept,
} from "./commanding.ts";

export interface CommandingHarness {
  readonly concept: CommandingConcept;
  readonly exits: number[];
  readonly written: Array<[string, string]>;
}

export type CommandingHarnessFactory = (
  arguments_: readonly string[],
) => CommandingHarness & { readonly environment?: CommandEnvironment };

export function commandingConformance(
  implementation: string,
  create: CommandingHarnessFactory,
): void {
  describe(`Commanding ${implementation}`, () => {
    test("follows its principle for one invocation", () => {
      const { concept, exits, written } = create(["publish", "notes"]);

      expect(concept.captureArguments({ arguments: null })).toEqual({
        words: ["publish", "notes"],
      });
      expect(concept.captureArguments({ arguments: null })).toEqual({
        words: ["publish", "notes"],
      });
      expect(() => concept.captureArguments({ arguments: ["inspect", "entry"] })).toThrow(
        InvocationCaptured,
      );
      concept.writeLine({ stream: "output", text: "Published notes." });
      concept.writeLine({ stream: "error", text: "One entry was skipped." });
      expect(concept.setExitStatus({ code: 2 })).toEqual({ code: 2, changed: true });
      expect(concept.setExitStatus({ code: 2 })).toEqual({ code: 2, changed: false });
      expect(() => concept.setExitStatus({ code: 1 })).toThrow(ExitSelected);

      expect(written).toEqual([
        ["output", "Published notes."],
        ["error", "One entry was skipped."],
      ]);
      expect(exits).toEqual([2]);
      expect(concept._invocation()).toEqual([{ words: ["publish", "notes"] }]);
      expect(concept._outcome()).toEqual([{ code: 2 }]);
    });

    test("copies and validates explicit argument lists", () => {
      const { concept } = create([]);
      const words = ["build"];
      const captured = concept.captureArguments({ arguments: words });
      words.push("later");
      expect(captured).toEqual({ words: ["build"] });

      const sparse: string[] = [];
      sparse.length = 1;
      const extra = ["build"] as string[] & { option?: string };
      extra.option = "watch";
      for (const value of [sparse, extra, ["build", 1]]) {
        expect(() => concept.captureArguments({ arguments: value as string[] })).toThrow(
          InvalidArguments,
        );
      }
    });

    test("validates output and exit effects before touching the host", () => {
      const { concept, exits, written } = create([]);
      expect(() => concept.writeLine({ stream: "log", text: "hello" })).toThrow(InvalidStream);
      expect(() => concept.writeLine({ stream: "output", text: "\ud800" })).toThrow(InvalidText);
      for (const code of [-1, 1.5, 256]) {
        expect(() => concept.setExitStatus({ code })).toThrow(InvalidExitCode);
      }
      expect(written).toEqual([]);
      expect(exits).toEqual([]);
    });
  });
}
