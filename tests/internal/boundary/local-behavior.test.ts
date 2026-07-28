import { describe, expect, test } from "vite-plus/test";
import { custom } from "@sync-engine/advanced";
import { assemble } from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { each, former, reaction, view, vocabulary, when, where } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { Frames } from "@sync-engine/internal/reads/frames";
import { oneOf } from "@sync-engine/internal/reads/matchers";

class WorkingConcept {
  static readonly queries = { _items: "many" } as const;
  readonly recorded: string[] = [];

  start({ value = "started" }: { value?: string }) {
    return { value };
  }

  record({ value }: { value: string }) {
    this.recorded.push(value);
    return {};
  }

  _items(_: Record<string, never>) {
    return [{ value: "one" }, { value: "two" }];
  }
}

const words = vocabulary({ concepts: { Working: WorkingConcept }, computations: {} });
const { Working } = words.concepts;

function accepts() {
  return true;
}

describe("portable-only ordinary assembly", () => {
  test("rejects closure and custom reactions even when they do not touch the boundary", () => {
    const ClosureReaction = reaction(() =>
      when(Working.start({ value: "closure" }).responds())
        .where((frames: Frames) => frames)
        .then(Working.record({ value: "closure" })),
    );
    const CustomReaction = reaction(() =>
      when(Working.start({ value: "custom" }).responds())
        .where(custom(accepts, [], []))
        .then(Working.record({ value: "custom" })),
    );

    expect(() =>
      assemble({
        vocabulary: words,
        composition: { CustomReaction, ClosureReaction },
      }),
    ).toThrow(
      "assemble: ordinary assembly accepts portable behavior only:\n" +
        '- local reaction "ClosureReaction": closure condition\n' +
        '- local reaction "CustomReaction": custom read operation "accepts"',
    );
  });

  test("rejects object-identity patterns and unlowered reactions", () => {
    class Identity {}
    const identity = new Identity();
    const IdentityReaction = reaction(() =>
      when(Working.start({ value: "identity", identity } as never).responds()).then(
        Working.record({ value: "identity" }),
      ),
    );
    const UnloweredReaction = endpoint("/unlowered", ({ hidden, value }: Vars) =>
      receive()
        .where((frames: Frames) => frames.map((frame) => ({ ...frame, [hidden]: "local" })))
        .then(Working.start({}).responds({ value }))
        .then(respond({ hidden })),
    );

    expect(() =>
      assemble({ vocabulary: words, composition: { UnloweredReaction, IdentityReaction } }),
    ).toThrow(/local reaction "IdentityReaction": object-identity pattern "literal Identity"/);
    expect(() =>
      assemble({ vocabulary: words, composition: { UnloweredReaction, IdentityReaction } }),
    ).toThrow(/local reaction "UnloweredReaction": .*unlowered reaction:/);
  });

  test("rejects opaque views and formers even when no reaction reaches them", () => {
    const localView = view("(value) passes local code", ({ value }) =>
      where(custom(accepts, [value], [])),
    ).holds();
    const localFormer = former("the local items", (_inputs, { value }) =>
      each(Working._items({}).is({ value }))
        .where(custom(accepts, [value], []))
        .form({ value }),
    );

    expect(() => assemble({ vocabulary: words, composition: { localView, localFormer } })).toThrow(
      "assemble: ordinary assembly accepts portable behavior only:\n" +
        '- local former "the local items": custom read operation "accepts"\n' +
        '- local view "(value) passes local code": custom read operation "accepts"',
    );
  });

  test("reports the same canonical inventory regardless of composition order", () => {
    const AReaction = reaction(() =>
      when(Working.start({ value: "a" }).responds())
        .where((frames: Frames) => frames)
        .then(Working.record({ value: "a" })),
    );
    const ZReaction = reaction(() =>
      when(Working.start({ value: "z" }).responds())
        .where((frames: Frames) => frames)
        .then(Working.record({ value: "z" })),
    );
    const errorOf = (composition: Record<string, unknown>) => {
      try {
        assemble({ vocabulary: words, composition });
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("expected portable-only assembly to reject local behavior");
    };

    expect(errorOf({ ZReaction, AReaction })).toBe(errorOf({ AReaction, ZReaction }));
  });

  test("accepts regexp, oneOf, and named-vocabulary computation behavior", async () => {
    const portableWords = vocabulary({
      concepts: {},
      computations: { accepted: ({ value }) => value === "accepted" },
    });
    const { accepted } = portableWords.computations;
    const Portable = endpoint("/portable", () =>
      receive({ first: /^ok$/, second: oneOf("a", "b") })
        .where(accepted({ value: "accepted" }))
        .then(respond({ ok: true })),
    );
    const app = assemble({ vocabulary: portableWords, composition: { Portable } });

    await expect(app.invoker.invoke("/portable", { first: "ok", second: "a" })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    });
  });
});
