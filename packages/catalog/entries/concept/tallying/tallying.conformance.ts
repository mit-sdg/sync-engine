import { expect } from "vite-plus/test";
import { NothingTallied } from "./tallying.shared.ts";

type MaybePromise<Value> = Value | Promise<Value>;

export interface TallyingImplementation {
  increment(input: { subject: string }): MaybePromise<{ subject: string; total: number }>;
  clear(input: { subject: string }): MaybePromise<{ subject: string }>;
  _total(input: { subject: string }): MaybePromise<{ total: number }>;
}

export async function expectTallyingConformance(tallying: TallyingImplementation): Promise<void> {
  // A subject with no total reads 0 rather than being unknown.
  expect(await tallying._total({ subject: "e1" })).toEqual({ total: 0 });

  expect(await tallying.increment({ subject: "e1" })).toEqual({ subject: "e1", total: 1 });
  await tallying.increment({ subject: "e1" });
  expect(await tallying.increment({ subject: "e1" })).toEqual({ subject: "e1", total: 3 });
  expect(await tallying._total({ subject: "e1" })).toEqual({ total: 3 });
  expect(await tallying._total({ subject: "e2" })).toEqual({ total: 0 });

  expect(await tallying.clear({ subject: "e1" })).toEqual({ subject: "e1" });
  expect(await tallying._total({ subject: "e1" })).toEqual({ total: 0 });

  let refusal: unknown;
  try {
    await tallying.clear({ subject: "e1" });
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(NothingTallied);
  expect(refusal).toMatchObject({ message: "That subject has no total to clear." });
}
