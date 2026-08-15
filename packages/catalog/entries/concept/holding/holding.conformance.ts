import { describe, expect, test } from "vite-plus/test";
import { HoldingConcept, type StopReason } from "./holding.ts";

export interface HoldingHarness {
  readonly concept: HoldingConcept;
  request(reason: StopReason): void;
  listening(): number;
}

export function holdingConformance(implementation: string, create: () => HoldingHarness): void {
  describe(`Holding ${implementation}`, () => {
    test("follows its principle with independent listener cleanup", async () => {
      const harness = create();
      const first = harness.concept.awaitStop();
      await Promise.resolve();
      expect(harness.concept._holding()).toEqual({ holding: 1 });
      harness.request("interrupt");
      const interrupted = await first;
      expect(harness.concept._hold({ hold: interrupted.hold })).toEqual([
        { state: "released", reason: "interrupt" },
      ]);
      expect(harness.listening()).toBe(0);

      const second = harness.concept.awaitStop();
      await Promise.resolve();
      harness.request("terminate");
      expect((await second).reason).toBe("terminate");
      expect(harness.concept._holding()).toEqual({ holding: 0 });
      expect(harness.listening()).toBe(0);
    });

    test("removes a failed hold and propagates listener setup faults", async () => {
      const concept = new HoldingConcept(() => {
        throw new Error("listener unavailable");
      });
      await expect(concept.awaitStop()).rejects.toThrow("listener unavailable");
      expect(concept._holding()).toEqual({ holding: 0 });
      expect(concept._hold({ hold: "hold:1" })).toEqual([]);
    });
  });
}
